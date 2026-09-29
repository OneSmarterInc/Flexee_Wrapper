import Link from "next/link";

type Portal = "admin" | "faculty" | "student";

export default function PortalNav({ active, isAdmin, canTeach }: {
  active?: Portal;
  isAdmin: boolean;
  canTeach: boolean;
}) {
  const links: { id: Portal; href: string; label: string; show: boolean }[] = [
    { id: "admin", href: "/admin", label: "Administration", show: isAdmin },
    { id: "faculty", href: "/faculty", label: "Faculty", show: canTeach || isAdmin },
    { id: "student", href: "/student", label: "Student", show: true },
  ];
  return (
    <nav className="portal-nav ui" aria-label="Portals">
      {links.filter((link) => link.show).map((link) => (
        <Link key={link.id} href={link.href} className="nav-button ghost"
          aria-current={active === link.id ? "page" : undefined}>{link.label}</Link>
      ))}
    </nav>
  );
}
