import type { AnchorHTMLAttributes, MouseEvent, PropsWithChildren } from "react";
import { routeHref } from "../navigation/router";
import { useAppNavigation } from "../navigation/NavigationContext";
import type { AppRoute, NavigateOptions } from "../navigation/types";

interface AppLinkProps extends Omit<AnchorHTMLAttributes<HTMLAnchorElement>, "href"> {
  route: AppRoute;
  navigation?: NavigateOptions;
}

export function AppLink({ route, navigation, onClick, children, ...props }: PropsWithChildren<AppLinkProps>) {
  const { navigate } = useAppNavigation();
  const handleClick = (event: MouseEvent<HTMLAnchorElement>) => {
    onClick?.(event);
    if (
      event.defaultPrevented ||
      event.button !== 0 ||
      event.metaKey ||
      event.ctrlKey ||
      event.shiftKey ||
      event.altKey
    ) return;
    event.preventDefault();
    navigate(route, navigation);
  };

  return <a href={routeHref(route)} onClick={handleClick} {...props}>{children}</a>;
}

