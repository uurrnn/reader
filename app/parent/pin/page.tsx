import { pinAction } from "./actions";

type Props = { searchParams: Promise<{ error?: string }> };

export default async function PinPage({ searchParams }: Props) {
  const { error } = await searchParams;
  return (
    <main className="flex min-h-dvh items-center justify-center bg-slate-950 p-6">
      <form action={pinAction} className="w-full max-w-xs space-y-4 text-center">
        <h1 className="text-lg font-semibold text-slate-100">Grown-ups only</h1>
        <label htmlFor="pin" className="sr-only">
          Parent PIN
        </label>
        <input
          id="pin"
          type="password"
          name="pin"
          inputMode="numeric"
          placeholder="PIN"
          autoFocus
          className="w-full rounded-xl border border-slate-700 bg-slate-900 px-4 py-3 text-center text-2xl tracking-[0.5em] text-slate-100 outline-none focus:border-slate-400"
        />
        {error && <p className="text-sm text-rose-300">Wrong PIN.</p>}
        <button
          type="submit"
          className="w-full rounded-xl bg-slate-200 px-4 py-3 font-semibold text-slate-900 active:bg-white"
        >
          Unlock
        </button>
      </form>
    </main>
  );
}
