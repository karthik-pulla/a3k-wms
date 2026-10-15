import type { UpdateGroup } from "../home/updates";

const MAX_ITEMS = 3;

export function UpdateCard({ group }: { group: UpdateGroup }) {
  const extra = group.count - Math.min(group.items.length, MAX_ITEMS);
  return (
    <article className="card glass" aria-labelledby={`card-${group.kind}`}>
      <div className="card-head">
        <div>
          <h3 className="card-title" id={`card-${group.kind}`}>{group.title}</h3>
          <p className="card-sub">{group.subtitle}</p>
        </div>
        <span className={`count${group.tone === "warn" ? " warn" : group.tone === "danger" ? " danger" : ""}`} aria-label={`${group.count} waiting`}>
          {group.count}
        </span>
      </div>
      {group.items.length ? (
        <ul className="items">
          {group.items.slice(0, MAX_ITEMS).map(it => (
            <li key={it.id}>
              <a className={`item${it.tone ? " " + it.tone : ""}`} href={it.href ?? `#/${group.mode}`}>
                <span className="what">{it.what}{it.detail && <small>{it.detail}</small>}</span>
                <span className="meta">{it.meta}</span>
              </a>
            </li>
          ))}
        </ul>
      ) : (
        <p className="empty-card">Nothing waiting.</p>
      )}
      {/* Phones show only the title and count, so the whole card opens the section */}
      <a className="card-cover" href={`#/${group.mode}`} aria-label={`Open ${group.title}`} tabIndex={-1} />
      <div className="card-foot">
        <a className="link" href={`#/${group.mode}`}>{extra > 0 ? `View all ${group.count}` : "Open"} ›</a>
      </div>
    </article>
  );
}
