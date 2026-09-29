// A system administrator may also teach or study; class roles never grant
// system administration. Only the initial landing page uses this priority.
export function landingPortal(systemRole: string, teachesClass: boolean): "admin" | "faculty" | "student" {
  if (systemRole === "admin") return "admin";
  return teachesClass ? "faculty" : "student";
}
