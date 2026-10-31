'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

export interface SideItem { label: string; href: string; hint?: string }
export interface SideGroup { title: string; items: SideItem[] }

// The project's sidebar: pages first, then the sections of the overview as anchors. The page the
// owner is on is marked; on a phone it becomes a row that scrolls sideways.
export function SideNav({ name, groups }: { name: string; groups: SideGroup[] }) {
  const path = usePathname();
  return (
    <nav className="side-nav" aria-label={`${name} sections`}>
      <p className="side-name">{name}</p>
      {groups.map((g) => (
        <div key={g.title} className="side-group">
          <span className="side-title">{g.title}</span>
          {g.items.map((i) => {
            const page = i.href.split('#')[0]!;
            const current = !i.href.includes('#') && path === page;
            return (
              <Link key={i.href} href={i.href} aria-current={current ? 'page' : undefined} className={current ? 'active' : undefined}>
                {i.label}{i.hint && <small>{i.hint}</small>}
              </Link>
            );
          })}
        </div>
      ))}
    </nav>
  );
}
