import Link from "next/link";
import LogoutButton from "@/components/LogoutButton";
import PortalNav from "@/components/PortalNav";

type Portal = "admin" | "faculty" | "student";

export default function WorkspaceShell({ active, isAdmin, canTeach, displayName, links = [], children }: {
  active: Portal;
  isAdmin: boolean;
  canTeach: boolean;
  displayName: string;
  links?: { href: string; label: string }[];
  children: React.ReactNode;
}) {
  return (
    <div className="workspace">
      <aside className="workspace-sidebar ui">
        <Link href="/" className="workspace-brand"><span className="workspace-brand-mark">F</span><span>Flexee<br /><small>Learning ERP</small></span></Link>
        <div className="workspace-sidebar-label">Workspaces</div>
        <PortalNav active={active} isAdmin={isAdmin} canTeach={canTeach} />
        {links.length > 0 && (
          <>
            <div className="workspace-sidebar-label">On this page</div>
            <nav className="workspace-section-nav" aria-label="On this page">
              {links.map((link) => <Link key={link.href} href={link.href}>{link.label}</Link>)}
            </nav>
          </>
        )}
        <div className="workspace-account">
          <span>Signed in as</span>
          <strong>{displayName}</strong>
          <Link href="/account">Account settings</Link>
        </div>
      </aside>
      <main className="catalog workspace-main">
        <div className="workspace-topline ui">{active === "admin" ? "Administration" : active === "faculty" ? "Faculty" : "Student"} workspace</div>
        {children}
      </main>
      <LogoutButton />
    </div>
  );
}
