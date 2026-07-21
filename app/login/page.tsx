import { loginAction } from "./actions";

type Props = { searchParams: Promise<{ error?: string }> };

export default async function LoginPage({ searchParams }: Props) {
  const { error } = await searchParams;
  return (
    <main className="flex min-h-dvh items-center justify-center bg-indigo-950 p-6">
      <form action={loginAction} className="w-full max-w-xs space-y-4 text-center">
        <p className="text-4xl">🌙</p>
        <h1 className="text-xl font-semibold text-indigo-100">Bedtime Reader</h1>
        <input
          type="password"
          name="password"
          placeholder="Family password"
          autoFocus
          className="w-full rounded-xl border border-indigo-700 bg-indigo-900 px-4 py-3 text-indigo-100 placeholder-indigo-400 outline-none focus:border-indigo-400"
        />
        {error && <p className="text-sm text-rose-300">That&apos;s not it — try again.</p>}
        <button
          type="submit"
          className="w-full rounded-xl bg-indigo-400 px-4 py-3 font-semibold text-indigo-950 active:bg-indigo-300"
        >
          Come in
        </button>
      </form>
    </main>
  );
}
