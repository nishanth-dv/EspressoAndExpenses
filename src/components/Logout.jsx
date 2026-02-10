import { useDispatch } from "react-redux";
import { logout } from "../redux/slices/authSlice";
import ActionButton from "../preStyledElements/actionButton/ActionButton";
import { memo } from "react";

const LogoutButton = () => {
  const dispatch = useDispatch();

  function handleLogout() {
    if (window.google) window.google.accounts.id.disableAutoSelect();

    dispatch(logout());
  }

  return (
    <ActionButton className="generic-button" onClick={handleLogout}>
      Logout
      <i className="fa-solid fa-arrow-right-from-bracket logout" />
    </ActionButton>
  );
};

export default memo(LogoutButton);
