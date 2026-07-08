import type { Meta, StoryObj } from "@storybook/react";
import { Badge } from "./badge";
import { Table, TableBody, TableCell, TableEmpty, TableHead, TableHeader, TableRow } from "./table";

const meta = {
  title: "UI/Table",
  component: Table,
  tags: ["autodocs"],
} satisfies Meta<typeof Table>;

export default meta;
type Story = StoryObj<typeof meta>;

const rows = [
  { id: "1", name: "Alice", role: "admin", status: "Active" },
  { id: "2", name: "Bob", role: "user", status: "Pending" },
];

export const Default: Story = {
  render: () => (
    <Table>
      <TableHeader>
        <TableRow className="border-b-2 border-border-strong bg-surface-sunken">
          <TableHead>Name</TableHead>
          <TableHead>Role</TableHead>
          <TableHead>Status</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {rows.map((r) => (
          <TableRow key={r.id}>
            <TableCell className="font-medium">{r.name}</TableCell>
            <TableCell>
              <Badge variant={r.role === "admin" ? "ink" : "secondary"}>{r.role}</Badge>
            </TableCell>
            <TableCell>
              <Badge variant={r.status === "Active" ? "success" : "warning"}>{r.status}</Badge>
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  ),
};

export const Empty: Story = {
  render: () => (
    <Table>
      <TableHeader>
        <TableRow className="border-b-2 border-border-strong bg-surface-sunken">
          <TableHead>Name</TableHead>
          <TableHead>Role</TableHead>
          <TableHead>Status</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        <TableEmpty colSpan={3}>No rows yet.</TableEmpty>
      </TableBody>
    </Table>
  ),
};
