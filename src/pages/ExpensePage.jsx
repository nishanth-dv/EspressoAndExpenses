import { memo } from "react";
import { useSelector } from "react-redux";
import { createOrFetchFile } from "../utils/googleDrive";
import { setDriveFile } from "../redux/slices/transactionSlice";
import { useLoader } from "../preStyledElements/loader/LoaderContext";
import Insights from "../components/Insights";
import { DEFAULT_DATA } from "../utils/constants";

const Expense = () => {
  const { showLoader, hideLoader } = useLoader();
  const transactions = useSelector((state) => state.transactions.transactions);

  async function testDrive() {
    showLoader();
    const { fileID, data } = await createOrFetchFile("transactions.json", {
      transactionData: DEFAULT_DATA,
    });
    setDriveFile({ fileID, data });
    hideLoader();
  }

  return (
    <>
      <Insights />
      <button onClick={testDrive}>Test Google Drive</button>
    </>
  );
};

export default memo(Expense);
