import { logout } from "@/app/actions";

export default function LogoutButton() {
  return (
    <form action={logout} style={{ display: "inline" }}>
      <button className="app-action signout-button" type="submit">Sign out</button>
    </form>
  );
}
