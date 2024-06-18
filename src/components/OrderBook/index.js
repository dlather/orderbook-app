import { Centrifuge } from "centrifuge";
import { useEffect, useState, useRef } from "react";
import { orderBookChannel, orderBookSymbol } from "../../constants";

const OrderBook = () => {
  const [bids, setBids] = useState([]);
  const [asks, setAsks] = useState([]);
  const centrifugeRef = useRef(null);
  const subscriptionRef = useRef(null);
  const lastSequence = useRef(0);
  const isReconnecting = useRef(false);
  const [reconnectionAttempts, setReconnectionAttempts] = useState(0);

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
      .on("connected", handleConnect)
      .on("disconnected", handleDisconnect)
      .connect();

    // Chennel to be used: orderbook:<symbol> => orderbook:BTC-USD
    const sub = centri.newSubscription(orderBookChannel);
    subscriptionRef.current = sub;

    sub
      .on("publication", handleOrderbookUpdate)
      .on("subscribing", function (ctx) {
        console.log(`subscribing: ${ctx.code}, ${ctx.reason}`);
      })
      .on("subscribed", function (ctx) {
        console.log(`subscribed: ${ctx.channel}`);
        setBids(ctx.data?.bids ?? []);
        setAsks(ctx.data?.asks ?? []);
        lastSequence.current = ctx.data.sequence ?? 0;
      })
      .on("unsubscribed", function (ctx) {
        console.log(`unsubscribed: ${ctx.code}, ${ctx.reason}`);
      })
      .subscribe();

    return () => {
      centri.disconnect();
      sub.unsubscribe();
    };
  }, []);

  const handleConnect = () => {
    console.log("Connected to websocket");
    isReconnecting.current = false;
    setReconnectionAttempts(0);
  };

  const handleDisconnect = (context) => {
    console.log("Disconnected from websocket:", context);
    if (!isReconnecting.current) {
      isReconnecting.current = true;
      attemptReconnection();
    }
  };

  const attemptReconnection = () => {
    const delay = Math.min(1000 * 2 ** reconnectionAttempts, 30000); // Exponential backoff with a max delay of 30 seconds
    setTimeout(() => {
      if (isReconnecting.current) {
        console.log(
          `Attempting to reconnect... (Attempt ${reconnectionAttempts + 1})`
        );
        setReconnectionAttempts((prev) => prev + 1);
        centrifugeRef.current.connect();
        subscriptionRef.current.subscribe();
      }
    }, delay);
  };

  const fetchSnapshot = async () => {
    console.log("fetching snapshot");
    try {
      const response = await fetch(
        `https://api.prod.rabbitx.io/markets/orderbook?market_id=${orderBookSymbol}&p_limit=100&p_page=0&p_order=DESC`
      );
      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }
      const data = await response.json();
      setBids(data.bids ?? []);
      setAsks(data.asks ?? []);
      lastSequence.current = data.sequence;
    } catch (error) {
      console.error("Error fetching initial snapshot:", error);
    }
  };

  const handleOrderbookUpdate = (message) => {
    const data = message.data;
    if (data.sequence <= lastSequence.current) {
      console.warn("Out of order sequence number, skipping update");
      return;
    }
    if (data.sequence !== lastSequence.current + 1) {
      console.warn("Missed sequence number, fetching snapshot");
      fetchSnapshot();
      return;
    }
    lastSequence.current = data.sequence;

    setBids((prevBids) => mergeOrders(prevBids, data.bids, "bids"));
    setAsks((prevAsks) => mergeOrders(prevAsks, data.asks, "asks"));
  };

  const mergeOrders = (currentOrders, newOrders, type) => {
    const orderMap = new Map(
      currentOrders.map((order) => [order[0], order[1]])
    );

    (newOrders ?? []).forEach((order) => {
      if (parseFloat(order[1]) === 0) {
        orderMap.delete(order[0]);
      } else {
        orderMap.set(order[0], order[1]);
      }
    });

    const mergedOrders = Array.from(orderMap.entries())
      .map(([price, quantity]) => [price, quantity])
      .sort((a, b) => parseFloat(a[0]) - parseFloat(b[0]));

    return type === "bids" ? mergedOrders.reverse() : mergedOrders;
  };
  return (
    <div className="overflow-x-auto">
      <table className="table">
        <thead>
          <tr>
            <th>Bids</th>
            <th></th>
            <th>Asks</th>
          </tr>
          <tr>
            <th>Size</th>
            <th>Price</th>
            <th>Prize</th>
            <th>Size</th>
          </tr>
        </thead>
        <tbody>
          {asks.length > 0 || bids.length > 0 ? (
            [...Array(Math.max(asks.length, bids.length))].map((emp, i) => {
              return (
                <tr key={i}>
                  <td>{i < bids.length ? bids[i][1] : null}</td>
                  <td>{i < bids.length ? bids[i][0] : null}</td>
                  <td>{i < asks.length ? asks[i][0] : null}</td>
                  <td>{i < asks.length ? asks[i][1] : null}</td>
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
