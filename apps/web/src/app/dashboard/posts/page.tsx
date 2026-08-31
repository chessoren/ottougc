import { PostGallery } from "@/components/dashboard/PostGallery";
import { RunAction } from "@/components/dashboard/RunAction";
import { PageHeader } from "@/components/dashboard/Shell";
import { produceNow } from "@/server/dashboard/actions";
import { getPosts, getPrimaryBrand } from "@/server/dashboard/queries";
import { ALL_SCENARIOS } from "@/server/knowledge/scenarios";

export const dynamic = "force-dynamic";

export default async function PostsPage() {
  const brand = await getPrimaryBrand();
  if (!brand) return null;

  const posts = await getPosts(brand.id, { limit: 120 });
  const formatNames = Object.fromEntries(ALL_SCENARIOS.map((s) => [s.id, s.name]));

  return (
    <>
      <PageHeader
        title="Videos"
        description="Everything your creators have made. Click one to see how it did, what quality control said, and what got decided."
        actions={
          <RunAction
            action={produceNow.bind(null, brand.id, 3)}
            label="Make 3 videos"
            running="Making…"
            variant="primary"
            size="md"
          />
        }
      />
      <PostGallery posts={posts} formatNames={formatNames} />
    </>
  );
}
