import Link from "next/link";

import { type ClientStatus } from "@/generated/prisma/enums";

import { ClientStatusBadge } from "./client-status-badge";

export type ClientRow = {
  id: string;
  name: string;
  company: string | null;
  email: string | null;
  phone: string | null;
  status: ClientStatus;
  updatedAt: Date;
};

const dateFormat = new Intl.DateTimeFormat("en", { dateStyle: "medium" });

/** Table on larger screens, stacked cards on phones. Each row opens the client. */
export function ClientsTable({ clients, basePath }: { clients: ClientRow[]; basePath: string }) {
  return (
    <>
      <div className="hidden overflow-hidden rounded-xl ring-1 ring-foreground/10 md:block">
        <table className="w-full text-sm">
          <thead className="bg-muted/50 text-left text-xs text-muted-foreground">
            <tr>
              <th scope="col" className="px-4 py-2.5 font-medium">
                Name
              </th>
              <th scope="col" className="px-4 py-2.5 font-medium">
                Contact
              </th>
              <th scope="col" className="px-4 py-2.5 font-medium">
                Status
              </th>
              <th scope="col" className="px-4 py-2.5 text-right font-medium">
                Updated
              </th>
            </tr>
          </thead>
          <tbody className="divide-y">
            {clients.map((client) => (
              <tr key={client.id} className="group relative hover:bg-muted/40">
                <td className="px-4 py-3">
                  <Link
                    href={`${basePath}/${client.id}`}
                    className="font-medium group-focus-within:underline after:absolute after:inset-0 focus-visible:outline-none"
                  >
                    {client.name}
                  </Link>
                  {client.company && <p className="text-muted-foreground">{client.company}</p>}
                </td>
                <td className="px-4 py-3 text-muted-foreground">
                  <p className="truncate">{client.email ?? "—"}</p>
                  {client.phone && <p>{client.phone}</p>}
                </td>
                <td className="px-4 py-3">
                  <ClientStatusBadge status={client.status} />
                </td>
                <td className="px-4 py-3 text-right text-muted-foreground tabular-nums">
                  {dateFormat.format(client.updatedAt)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <ul className="grid grid-cols-1 gap-2 md:hidden">
        {clients.map((client) => (
          <li key={client.id}>
            <Link
              href={`${basePath}/${client.id}`}
              className="block rounded-xl p-4 ring-1 ring-foreground/10 hover:bg-muted/40"
            >
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="truncate font-medium">{client.name}</p>
                  {client.company && (
                    <p className="truncate text-sm text-muted-foreground">{client.company}</p>
                  )}
                </div>
                <ClientStatusBadge status={client.status} />
              </div>
              {client.email && (
                <p className="mt-2 truncate text-sm text-muted-foreground">{client.email}</p>
              )}
            </Link>
          </li>
        ))}
      </ul>
    </>
  );
}
