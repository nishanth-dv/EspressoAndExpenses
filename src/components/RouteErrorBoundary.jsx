import { Component } from "react";
import PropTypes from "prop-types";

// Catches a failed lazy chunk import or a render throw in the routed page so a
// failure shows a recovery card instead of a blank screen. Resets itself when
// `resetKey` changes (i.e. the user navigates to a different route).
export default class RouteErrorBoundary extends Component {
  constructor(props) {
    super(props);
    this.state = { error: null };
  }

  static getDerivedStateFromError(error) {
    return { error };
  }

  componentDidUpdate(prevProps) {
    if (prevProps.resetKey !== this.props.resetKey && this.state.error) {
      this.setState({ error: null });
    }
  }

  render() {
    if (this.state.error) {
      return (
        <div className="reconnect-screen">
          <div className="reconnect-card">
            <p className="reconnect-title">This page didn&apos;t load</p>
            <p className="reconnect-sub">
              Something interrupted loading. Reload to try again — your data is
              safe in your Drive.
            </p>
            <button
              type="button"
              className="generic-button reconnect-btn"
              onClick={() => window.location.reload()}
            >
              Reload
            </button>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}

RouteErrorBoundary.propTypes = {
  resetKey: PropTypes.any,
  children: PropTypes.node,
};
