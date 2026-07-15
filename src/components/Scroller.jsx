import { OverlayScrollbarsComponent } from "overlayscrollbars-react";

const DEFAULT_OPTIONS = {
  scrollbars: {
    autoHide: "leave",
    autoHideDelay: 400,
    theme: "os-theme-app",
  },
};

export default function Scroller({ className, children, options, ...rest }) {
  return (
    <OverlayScrollbarsComponent
      className={className}
      options={{ ...DEFAULT_OPTIONS, ...options }}
      defer
      {...rest}
    >
      {children}
    </OverlayScrollbarsComponent>
  );
}
