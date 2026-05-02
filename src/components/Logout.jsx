/* global google */
import { memo } from "react";
import { useDispatch, useSelector } from "react-redux";
import { logout } from "../redux/slices/authSlice";
import { reset as resetTransactions } from "../redux/slices/transactionSlice";
import { resetFilter } from "../redux/slices/filterSlice";
import { clearAccessToken } from "../utils/googleDrive";
import ActionButton from "../preStyledElements/actionButton/ActionButton";

const LogoutButton = () => {
  const dispatch = useDispatch();
  const userInfo = useSelector((state) => state.auth.user);

  function handleLogout() {
    // Clear in-memory Drive access token so a future login starts fresh
    clearAccessToken();
    dispatch(resetTransactions());
    dispatch(resetFilter());
    dispatch(logout());

    if (window.google) {
      google.accounts.id.disableAutoSelect();
      if (userInfo?.email) {
        // Revoke Google's consent so auto-select doesn't re-sign them in immediately
        google.accounts.id.revoke(userInfo.email, () => {});
      }
    }
  }

  return (
    <ActionButton className="generic-button" onClick={handleLogout}>
      Logout
      <i className="fa-solid fa-arrow-right-from-bracket logout" />
    </ActionButton>
  );
};

export default memo(LogoutButton);
