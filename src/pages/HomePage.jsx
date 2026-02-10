import { memo } from "react";
import { Outlet } from "react-router-dom";
import Navbar from "../components/Navbar";
import Actions from "../components/Actions";

const Home = () => (
  <>
    <Navbar />
    <div className="outlet">
      <Outlet />
    </div>
    <Actions />
  </>
);
export default memo(Home);
