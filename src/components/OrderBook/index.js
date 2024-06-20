import { Centrifuge } from "centrifuge";
import { useEffect, useState, useRef } from "react";
import { orderBookChannel, orderBookSymbol } from "../../constants";

const OrderBook = () => {
  const [bids, setBids] = useState([]); // desending order
  const [asks, setAsks] = useState([]); // asending order
  const [maxAskSize, setmaxAskSize] = useState(0);
  const [maxBidSize, setmaxBidSize] = useState(0);
  const [connected, setconnected] = useState(false);
  const centrifugeRef = useRef(null);
  const lastSequence = useRef(0);

  useEffect(() => {
    const centri = new Centrifuge("wss://api.prod.rabbitx.io/ws", {
      debug: true,
      token:
        "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiI0MDAwMDAwMDAwIiwiZXhwIjo2NTQ4NDg3NTY5fQ.o_qBZltZdDHBH3zHPQkcRhVBQCtejIuyq8V1yj5kYq8",
      // "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIwIiwiZXhwIjo1MjYyNjUyMDEwfQ.x_245iYDEvTTbraw1gt4jmFRFfgMJb-GJ-hsU9HuDik",
    });
    centrifugeRef.current = centri;

    centri
      .on("connecting", function (ctx) {
        console.log(`connecting: ${ctx.code}, ${ctx.reason}`);
        setconnected(false);
      })
      .on("connected", function (ctx) {
        console.log(`connected over ${ctx.transport}`);
        setconnected(true);
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
    setconnected(false);
    // connect() client will tries to reestablish connection periodically
    centrifugeRef.current.connect();
  };

  const handlePublication = (message) => {
    const data = message.data;
    if (data.sequence !== lastSequence.current + 1 && connected) {
      console.log("disconnecting....");
      centrifugeRef.current.disconnect();
      setconnected(false);
      return;
    }
    if (!connected) {
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
  return connected ? (
    <div className="overflow-x-auto">
      <table className="table p-4">
        <div className="flex text-lg text-gray-600 my-2 justify-center items-center">
          <div className="flex justify-between w-full px-8 items-center">
            <p>Size</p>
            <p>Bid Price</p>
          </div>
          <div className="flex justify-between w-full px-8 items-center">
            <p>Ask Price</p>
            <p>Size</p>
          </div>
        </div>
        <tbody>
          {asks.length > 0 || bids.length > 0 ? (
            [...Array(Math.max(asks.length, bids.length))].map((_, i) => {
              return (
                <tr key={i} className="grid grid-cols-2 gap-2 py-0">
                  {i < bids.length ? (
                    <td className="bg-green-50 flex justify-between items-center relative z-10 py-0">
                      <p className="text-gray-400 w-20">{bids[i][1]}</p>
                      <div
                        className="bg-green-500 h-8 mx-2  rounded-sm"
                        style={{
                          width: `${(bids[i][1] / maxBidSize) * 60}%`,
                          marginLeft: "auto",
                        }}
                      ></div>
                      <p className="font-bold text-green-800 text-center w-20">
                        {bids[i][0]}
                      </p>
                    </td>
                  ) : null}
                  {i < asks.length ? (
                    <td className="bg-red-50 flex justify-between items-center relative z-10 py-0">
                      <p className="font-bold text-red-800 text-center w-20">
                        {asks[i][0]}
                      </p>
                      <div
                        className="bg-red-500 h-6 mx-2  rounded-md"
                        style={{
                          width: `${(asks[i][1] / maxAskSize) * 60}%`,
                          marginRight: "auto",
                        }}
                      ></div>

                      <p className="text-gray-400 w-20">{asks[i][1]}</p>
                    </td>
                  ) : null}
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
  ) : (
    <div className="flex justify-center items-center mx-auto">
      Connecting ...
    </div>
  );
};

export default OrderBook;
