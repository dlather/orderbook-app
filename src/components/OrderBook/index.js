import { Centrifuge } from "centrifuge";
import { useEffect, useState, useRef } from "react";

const OrderBook = () => {
  const [bids, setBids] = useState([]);
  const [asks, setAsks] = useState([]);
  const [centrifuge, setcentrifuge] = useState(null);
  const [subscription, setsubscription] = useState(null);
  const lastSequence = useRef(0);
  const isReconnecting = useRef(false);

  useEffect(() => {
    const centri = new Centrifuge("wss://api.prod.rabbitx.io/ws", {
      token:
        "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiI0MDAwMDAwMDAwIiwiZXhwIjo2NTQ4NDg3NTY5fQ.o_qBZltZdDHBH3zHPQkcRhVBQCtejIuyq8V1yj5kYq8",
      // "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIwIiwiZXhwIjo1MjYyNjUyMDEwfQ.x_245iYDEvTTbraw1gt4jmFRFfgMJb-GJ-hsU9HuDik",
    });

    // Chennel to be used: orderbook:<symbol> => orderbook:BTC-USD
    const sub = centri.newSubscription("orderbook:BTC-USD");

    sub.on("publication", handleOrderbookUpdate);
    centri.on("connected", handleConnect);
    centri.on("disconnected", handleDisconnect);

    sub.subscribe("orderbook:BTC-USD");
    centri.connect();

    setcentrifuge(centri);
    setsubscription(sub);

    return () => {
      centri.disconnect();
    };
  }, []);

  const handleConnect = () => {
    console.log("Connected to websocket");
    isReconnecting.current = false;
    lastSequence.current = 0;
    subscription.subscribe("orderbook:BTC-USD");
  };

  const handleDisconnect = (context) => {
    console.log("Disconnected from websocket:", context);
    if (!isReconnecting.current) {
      isReconnecting.current = true;
      attemptReconnection();
    }
  };

  const attemptReconnection = () => {
    setTimeout(() => {
      if (isReconnecting.current) {
        console.log("Attempting to reconnect...");
        centrifuge.connect();
        subscription.subscribe("orderbook:BTC-USD");
      }
    }, 5000); // Attempt to reconnect every 5 seconds
  };

  const handleOrderbookUpdate = (message) => {
    const data = message.data;
    if (data.sequence <= lastSequence.current) {
      console.warn("Out of order sequence number, skipping update");
      return;
    }
    lastSequence.current = data.sequence;

    setBids((prevBids) => mergeOrders(prevBids, data.bids, "bids"));
    setAsks((prevAsks) => mergeOrders(prevAsks, data.asks, "asks"));
  };

  const mergeOrders = (currentOrders, newOrders, type) => {
    console.log(newOrders);
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
  console.log(asks.length > bids.length ? asks.length : bids.length);
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
            <div>Empty</div>
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
