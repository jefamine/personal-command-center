import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type PropsWithChildren
} from "react";
import { routeFromUrl, routeHref, routeLabel } from "./router";
import type { AppRoute, NavigateOptions, NavigationCrumb } from "./types";

interface BrowserNavigationState {
  psozh: true;
  index: number;
  scrollY: number;
  trail: NavigationCrumb[];
}

interface AppNavigationValue {
  route: AppRoute;
  trail: NavigationCrumb[];
  canGoBack: boolean;
  canGoForward: boolean;
  navigate: (route: AppRoute, options?: NavigateOptions) => void;
  back: () => void;
  forward: () => void;
}

const AppNavigationContext = createContext<AppNavigationValue | null>(null);

function isNavigationState(value: unknown): value is BrowserNavigationState {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Partial<BrowserNavigationState>;
  return candidate.psozh === true && Number.isInteger(candidate.index) && Array.isArray(candidate.trail);
}

function currentState(): BrowserNavigationState {
  const existing = window.history.state;
  if (isNavigationState(existing)) return existing;
  const route = routeFromUrl(new URL(window.location.href));
  return {
    psozh: true,
    index: 0,
    scrollY: window.scrollY,
    trail: [{ label: routeLabel(route), href: routeHref(route) }]
  };
}

export function AppNavigationProvider({ children }: PropsWithChildren) {
  const initial = useRef(currentState());
  const [route, setRoute] = useState(() => routeFromUrl(new URL(window.location.href)));
  const [trail, setTrail] = useState<NavigationCrumb[]>(initial.current.trail);
  const [index, setIndex] = useState(initial.current.index);
  const [furthestIndex, setFurthestIndex] = useState(initial.current.index);

  useEffect(() => {
    window.history.replaceState(initial.current, "", window.location.href);
    const onPopState = (event: PopStateEvent) => {
      const state = isNavigationState(event.state) ? event.state : currentState();
      setRoute(routeFromUrl(new URL(window.location.href)));
      setTrail(state.trail);
      setIndex(state.index);
      requestAnimationFrame(() => window.scrollTo({ top: state.scrollY, behavior: "auto" }));
    };
    window.addEventListener("popstate", onPopState);
    return () => window.removeEventListener("popstate", onPopState);
  }, []);

  const navigate = useCallback((nextRoute: AppRoute, options: NavigateOptions = {}) => {
    const current = currentState();
    window.history.replaceState({ ...current, scrollY: window.scrollY }, "", window.location.href);
    const href = routeHref(nextRoute);
    const crumb = { label: options.label ?? routeLabel(nextRoute), href };
    const nextTrail = options.trail
      ? options.trail
      : options.preserveTrail
        ? [...current.trail, crumb]
        : [crumb];
    const nextIndex = current.index + 1;
    const nextState: BrowserNavigationState = {
      psozh: true,
      index: nextIndex,
      scrollY: 0,
      trail: nextTrail
    };
    window.history.pushState(nextState, "", href);
    setRoute(nextRoute);
    setTrail(nextTrail);
    setIndex(nextIndex);
    setFurthestIndex(nextIndex);
    window.scrollTo({ top: 0, behavior: "auto" });
  }, []);

  const value = useMemo<AppNavigationValue>(() => ({
    route,
    trail,
    canGoBack: index > 0,
    canGoForward: index < furthestIndex,
    navigate,
    back: () => window.history.back(),
    forward: () => window.history.forward()
  }), [furthestIndex, index, navigate, route, trail]);

  return <AppNavigationContext.Provider value={value}>{children}</AppNavigationContext.Provider>;
}

export function useAppNavigation(): AppNavigationValue {
  const context = useContext(AppNavigationContext);
  if (!context) throw new Error("useAppNavigation должен использоваться внутри AppNavigationProvider");
  return context;
}

