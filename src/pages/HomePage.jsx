import { memo, useEffect } from "react";
import { Outlet } from "react-router-dom";
import { useSelector, useDispatch } from "react-redux";
import Navbar from "../components/Navbar";
import Actions from "../components/Actions";
import DateFilter from "../components/DateFilter";
import { initializeDrive } from "../redux/slices/transactionSlice";

const Home = () => {
  const dispatch = useDispatch();
  const fileID = useSelector((state) => state.transactions.fileID);
  const status = useSelector((state) => state.transactions.status);

  // Initial load
  useEffect(() => {
    if (!fileID) dispatch(initializeDrive());
  }, [dispatch, fileID]);

  // Re-try when the user returns to the tab after the Drive session expired
  useEffect(() => {
    function onVisible() {
      if (document.visibilityState === "visible" && status === "error") {
        dispatch(initializeDrive());
      }
    }
    document.addEventListener("visibilitychange", onVisible);
    return () => document.removeEventListener("visibilitychange", onVisible);
  }, [dispatch, status]);

  return (
    <>
      <Navbar />
      <div className="outlet">
        <DateFilter />
        <Outlet />
      </div>
      <Actions />
    </>
  );
};

export default memo(Home);
