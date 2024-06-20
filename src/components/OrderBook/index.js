import { Centrifuge } from "centrifuge";
import { useEffect, useState, useRef } from "react";
import { orderBookChannel, orderBookSymbol } from "../../constants";

const OrderBook = () => {
  const [bids, setBids] = useState([]); // desending order
  const [asks, setAsks] = useState([]); // asending order
  const [maxAskSize, setmaxAskSize] = useState(0);
  const [maxBidSize, setmaxBidSize] = useState(0);
  const centrifugeRef = useRef(null);
  const lastSequence = useRef(0);
  const isFecthingSnapshot = useRef(false);
  const messageBuffer = useRef([]);
  const abortControllerRef = useRef(null);

  useEffect(() => {
    const centri = new Centrifuge("wss://api.prod.rabbitx.io/ws", {
      // debug: true,
      token:
        "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiI0MDAwMDAwMDAwIiwiZXhwIjo2NTQ4NDg3NTY5fQ.o_qBZltZdDHBH3zHPQkcRhVBQCtejIuyq8V1yj5kYq8",
      // "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIwIiwiZXhwIjo1MjYyNjUyMDEwfQ.x_245iYDEvTTbraw1gt4jmFRFfgMJb-GJ-hsU9HuDik",
    });
    centrifugeRef.current = centri;

    centri
      .on("connecting", function (ctx) {
        console.log(`connecting: ${ctx.code}, ${ctx.reason}`);
      })
      .on("connected", function (ctx) {
        console.log(`connected over ${ctx.transport}`);
      })
      .on("disconnected", handleDisconnect)
      .connect();

    // Channel to be used: orderbook:<symbol> => orderbook:BTC-USD
    const sub = centri.newSubscription(orderBookChannel);

    sub
      .on("publication", handlePublication)
      .on("subscribing", function (ctx) {
        console.log(`subscribing: ${ctx.code}, ${ctx.reason}`);
      })
      .on("subscribed", handleSubscribed)
      .on("unsubscribed", function (ctx) {
        console.log(`unsubscribed: ${ctx.code}, ${ctx.reason}`);
      })
      .subscribe();

    return () => {
      centri.disconnect();
      sub.unsubscribe();
    };
  }, []);

  const handleSubscribed = (ctx) => {
    console.log(`subscribed: ${ctx.channel}`);
    // asks and bids are sorted in asending by default
    setBids((ctx.data?.bids ?? []).reverse());
    setmaxBidSize(findMaxSize(ctx.data?.bids ?? []));
    setmaxAskSize(findMaxSize(ctx.data?.asks ?? []));
    setAsks(ctx.data?.asks ?? []);
    lastSequence.current = ctx.data.sequence ?? 0;
  };

  const findMaxSize = (pairs) => {
    return pairs.length > 0
      ? pairs.reduce(
          (max, current) =>
            parseFloat(current[1]) > max ? parseFloat(current[1]) : max,
          parseFloat(pairs[0][1])
        )
      : 0;
  };

  const handleDisconnect = (context) => {
    console.log("Disconnected from websocket:", context);
    // connect() client will tries to reestablish connection periodically
    centrifugeRef.current.connect();
  };

  const processBufferedMessages = (data) => {
    console.log(
      `processBufferedMessages: ${JSON.stringify(messageBuffer.current)}`
    );
    lastSequence.current = data.sequence;
    const unprocessedBids = [];
    const unprocessedAsks = [];
    (messageBuffer.current ?? [])
      .filter((mess) => mess.sequence >= data.sequence)
      .forEach((message) => {
        if (message.sequence === lastSequence.current + 1) {
          lastSequence.current = message.sequence;
          unprocessedBids.push(message.bids);
          unprocessedAsks.push(message.asks);
        } else {
          console.log(
            "calling resynchronize as message buffer sequence is missed"
          );
          resynchronize();
          return;
        }
      });

    let bidsData = (data.bids ?? []).reverse();
    let asksData = data.asks ?? [];
    unprocessedBids.forEach((unprocessedBid) => {
      bidsData = mergeOrders(bidsData, unprocessedBid, "bid");
    });
    unprocessedAsks.forEach((unprocessedAsk) => {
      bidsData = mergeOrders(asksData, unprocessedAsk, "ask");
    });
    setmaxBidSize(findMaxSize(bidsData) ?? []);
    setBids(bidsData);
    setmaxAskSize(findMaxSize(bidsData ?? []));
    setAsks(asksData);
    messageBuffer.current = [];
  };

  const resynchronize = () => {
    messageBuffer.current = [];
    abortControllerRef.current.abort();
    fetchSnapshot();
  };

  const fetchSnapshot = async () => {
    console.log("fetching snapshot");
    isFecthingSnapshot.current = true;
    try {
      const controller = new AbortController();
      abortControllerRef.current = controller;
      const signal = controller.signal;
      // API returns bids and asks in asc order
      const response = await fetch(
        `https://api.prod.rabbitx.io/markets/orderbook?market_id=${orderBookSymbol}&p_limit=100&p_page=0&p_order=ASC`,
        { signal }
      );
      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }
      const data = await response.json();
      console.log(`Response from Snapshot: ${JSON.stringify(data)}`);
      processBufferedMessages(data);
    } catch (error) {
      console.error("Error fetching snapshot:", error);
    } finally {
      isFecthingSnapshot.current = false;
      abortControllerRef.current = null;
    }
  };

  const handlePublication = (message) => {
    const data = message.data;
    console.log(data.sequence);
    if (isFecthingSnapshot.current) {
      console.log("Waiting for snapshot");
      messageBuffer.current.push(data);
      console.log(messageBuffer);
      return;
    }

    if (
      !isFecthingSnapshot.current &&
      data.sequence !== lastSequence.current + 1
    ) {
      console.warn("Missed sequence number, fetching snapshot");
      messageBuffer.current = [];
      messageBuffer.current.push(data);
      console.log(messageBuffer);
      fetchSnapshot();
      return;
    }
    if (data.sequence <= lastSequence.current) {
      console.warn("Out of order sequence number, skipping update");
      return;
    }

    lastSequence.current = data.sequence;
    setBids((prevBids) => {
      const updatedBids = mergeOrders(prevBids, data.bids, "bid");
      setmaxBidSize(findMaxSize(updatedBids ?? []));
      return updatedBids;
    });
    setAsks((prevAsks) => {
      const updatedAsks = mergeOrders(prevAsks, data.asks, "ask");
      setmaxAskSize(findMaxSize(updatedAsks ?? []));
      return updatedAsks;
    });
  };

  const mergeOrders = (side, updates, orderType) => {
    // TODO: do we need to copy
    const updatedSide = [...side];
    updates.forEach(([price, quantity]) => {
      const index = updatedSide.findIndex(
        (order) => parseFloat(order[0]) === parseFloat(price)
      );
      if (index !== -1) {
        if (parseFloat(quantity) === 0) {
          updatedSide.splice(index, 1);
        } else {
          updatedSide[index][1] = quantity;
        }
      } else if (parseFloat(quantity) !== 0) {
        updatedSide.push([price, quantity]);
        updatedSide.sort((a, b) =>
          orderType === "bid"
            ? parseFloat(b[0]) - parseFloat(a[0])
            : parseFloat(a[0]) - parseFloat(b[0])
        );
      }
    });
    return updatedSide;
  };
  return (
    <div className="overflow-x-auto">
      <table className="table p-4">
        <thead>
          <tr>
            <th>{orderBookSymbol}</th>
          </tr>
        </thead>
        <tbody>
          {asks.length > 0 || bids.length > 0 ? (
            [...Array(Math.max(asks.length, bids.length))].map((emp, i) => {
              return (
                <tr key={i} className="grid grid-cols-2 gap-2">
                  <td className="bg-green-100 flex justify-between items-center">
                    <div className="flex justify-center items-center">
                      {i < bids.length ? (
                        <progress
                          className="progress progress-success w-56 mx-2"
                          value={bids.length ? bids[i][1] : 0}
                          max={maxBidSize}
                        ></progress>
                      ) : null}
                      <p className="text-gray-400 w-20">
                        {i < bids.length ? bids[i][1] : null}
                      </p>
                    </div>
                    <p className="font-bold text-green-800">
                      {i < bids.length ? bids[i][0] : null}
                    </p>
                  </td>
                  <td className="bg-red-100 flex justify-between items-center">
                    <p className="font-bold text-red-800">
                      {i < asks.length ? asks[i][0] : null}
                    </p>
                    <div className="flex justify-center items-center">
                      {i < asks.length ? (
                        <progress
                          className="progress progress-error w-72 mx-2"
                          value={asks.length ? asks[i][1] : 0}
                          max={maxAskSize}
                        ></progress>
                      ) : null}
                      <p className="text-gray-400 w-20">
                        {i < asks.length ? asks[i][1] : null}
                      </p>
                    </div>
                  </td>
                </tr>
              );
            })
          ) : (
            <tr>
              <td>No Date Found</td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
    // <div className="">
    //   <div className="bids">
    //     <h2>Bids</h2>
    //     <ul>
    //       {bids.map((bid, index) => (
    //         <li key={index}>{`Price: ${bid[0]}, Quantity: ${bid[1]}`}</li>
    //       ))}
    //     </ul>
    //   </div>
    //   <div className="asks">
    //     <h2>Asks</h2>
    //     <ul>
    //       {asks.map((ask, index) => (
    //         <li key={index}>{`Price: ${ask[0]}, Quantity: ${ask[1]}`}</li>
    //       ))}
    //     </ul>
    //   </div>
    // </div>
  );
};

export default OrderBook;
