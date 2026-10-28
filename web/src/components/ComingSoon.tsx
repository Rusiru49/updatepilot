import { Card } from "./ui";

export function ComingSoon({ title, when }: { title: string; when: string }) {
  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold">{title}</h1>
      <Card>
        <p className="text-muted">This page is planned for {when}.</p>
      </Card>
    </div>
  );
}