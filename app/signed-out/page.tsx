import { SignedOut } from "../../components/signed-out";

export default async function SignedOutPage({ searchParams }: { searchParams: Promise<{ error?: string | string[] }> }) {
  const { error } = await searchParams;
  return <SignedOut error={typeof error === "string" && /^[A-Z_]{1,40}$/.test(error) ? error : ""} />;
}
