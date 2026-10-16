import LoginButton from './LoginButton'

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; next?: string }>
}) {
  const { error, next } = await searchParams
  return (
    <main className="mx-auto flex min-h-screen max-w-sm flex-col justify-center gap-4 p-8">
      <h1 className="text-2xl font-semibold">porticific</h1>
      {error && <p className="text-sm text-red-600">로그인에 실패했습니다. 다시 시도해 주세요.</p>}
      <LoginButton next={next} />
    </main>
  )
}
