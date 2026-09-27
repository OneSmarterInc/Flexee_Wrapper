import { logout } from "@/app/actions";
export default function LogoutButton() {
  return (
    <form action={logout} style={{ display: "inline" }}>
      <button className="theme-toggle ui" style={{ right: "5.2rem" }} type="submit">Sign out</button>
    </form>
  );
}
