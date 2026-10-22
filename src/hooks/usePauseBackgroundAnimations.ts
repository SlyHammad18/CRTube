import { useEffect } from "react";

/**
 * WebKitGTK keeps compositing running CSS animations while the window is
 * unfocused or hidden, so perpetual effects (hero burn, caret, sheen, EQ bars)
 * burn CPU in the background for nothing. Toggling `data-unfocused` on <html>
 * lets theme.css pause every animation when the app is not actively focused.
 */
export function usePauseBackgroundAnimations() {
  useEffect(() => {
    const root = document.documentElement;
    let focused = document.hasFocus();
    let visible = !document.hidden;

    const apply = () => {
      if (focused && visible) {
        root.removeAttribute("data-unfocused");
      } else {
        root.setAttribute("data-unfocused", "true");
      }
    };

    const onBlur = () => {
      focused = false;
      apply();
    };
    const onFocus = () => {
      focused = true;
      apply();
    };
    const onVisibility = () => {
      visible = !document.hidden;
      apply();
    };

    apply();
    window.addEventListener("blur", onBlur);
    window.addEventListener("focus", onFocus);
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      root.removeAttribute("data-unfocused");
      window.removeEventListener("blur", onBlur);
      window.removeEventListener("focus", onFocus);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, []);
}
