import { ArrowLeft, ArrowRight, ChevronRight, Home } from "lucide-react";
import { useAppNavigation } from "../navigation/NavigationContext";
import { routeFromUrl } from "../navigation/router";

export function NavigationTrail() {
  const { trail, canGoBack, canGoForward, back, forward, navigate } = useAppNavigation();
  if (trail.length <= 1 && !canGoBack) return null;

  return (
    <nav className="app-navigation-trail" aria-label="Путь и история переходов">
      <div className="app-navigation-history">
        <button type="button" onClick={back} disabled={!canGoBack} aria-label="Назад"><ArrowLeft size={17} /></button>
        <button type="button" onClick={forward} disabled={!canGoForward} aria-label="Вперёд"><ArrowRight size={17} /></button>
      </div>
      <ol>
        {trail.map((crumb, index) => (
          <li key={`${crumb.href}-${index}`}>
            {index ? <ChevronRight size={14} /> : <Home size={14} />}
            {index === trail.length - 1 ? (
              <span aria-current="page">{crumb.label}</span>
            ) : (
              <a href={crumb.href} onClick={(event) => {
                if (event.button !== 0 || event.ctrlKey || event.metaKey || event.shiftKey || event.altKey) return;
                event.preventDefault();
                const url = new URL(crumb.href, window.location.href);
                navigate(routeFromUrl(url), { trail: trail.slice(0, index + 1) });
              }}>{crumb.label}</a>
            )}
          </li>
        ))}
      </ol>
    </nav>
  );
}
