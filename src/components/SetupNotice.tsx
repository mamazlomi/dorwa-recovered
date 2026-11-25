export function SetupNotice({ title, body }: { title: string; body: string }) {
  return (
    <div className="card border-amber-300 bg-amber-50">
      <h2 className="mb-2 font-bold">{title}</h2>
      <p className="text-sm text-muted">{body}</p>
    </div>
  );
}

export function ErrorBox({ message }: { message: string }) {
  return <p className="rounded-xl bg-red-50 px-3 py-2 text-sm text-red-700">{message}</p>;
}

export function OkBox({ message }: { message: string }) {
  return <p className="rounded-xl bg-brand-50 px-3 py-2 text-sm text-brand-700">{message}</p>;
}
