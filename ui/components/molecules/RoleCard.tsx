import Badge from "@/components/atoms/Badge";

export interface Role {
  name: string;
  domain: string;
  permissions: string[];
  direct: boolean;
}

export default function RoleCard({ role }: { role: Role }) {
  return (
    <div
      className="rounded-xl border p-4 flex flex-col gap-2"
      style={{
        background: "var(--surface)",
        borderColor: role.direct ? "var(--line-green)" : "var(--border)",
        boxShadow: "var(--shadow-sm)",
      }}
    >
      <div className="flex items-start justify-between gap-2">
        <div>
          <p className="text-xs" style={{ color: "var(--text-muted)" }}>
            {role.domain}
          </p>
          <p className="font-semibold text-sm mt-0.5" style={{ color: "var(--text-primary)" }}>
            {role.name}
          </p>
        </div>
        {role.direct && <Badge variant="green">Direct</Badge>}
      </div>
      <div className="flex flex-wrap gap-1.5 pt-1">
        {role.permissions.map((p) => (
          <Badge key={p} variant="blue">
            {p}
          </Badge>
        ))}
      </div>
    </div>
  );
}
