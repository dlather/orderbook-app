import { orderBookSymbol } from "../constants";
const Header = () => {
  return (
    <div className="navbar bg-base-100">
      <div className="flex-1 justify-between items-center">
        <a className="btn btn-ghost text-xl">RabbitX - Order Book</a>
        <p className="font-semibold mx-4">{orderBookSymbol}</p>
      </div>
    </div>
  );
};

export default Header;
