import { EssayPage } from "@/components/pages/essay-page";

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
	const { id } = await params;
	return <EssayPage id={id} />;
}
