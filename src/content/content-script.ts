import { PostController } from "@/content/post-controller";
import { LinkedInAdapter } from "@/platforms/linkedin/linkedin-adapter";
import { DEFAULT_SETTINGS } from "@/shared/constants";

const adapter = new LinkedInAdapter();

if (adapter.matches(new URL(window.location.href))) {
  new PostController({ adapter, settings: DEFAULT_SETTINGS }).start();
}
