import { convexTest } from "convex-test";
import schema from "../../convex/schema";

const modules = import.meta.glob("../../convex/**/*.ts");

export function createConvexHarness() {
  const backend = convexTest(schema, modules);
  const asAccount = (accountId: string) =>
    backend.withIdentity({
      subject: accountId,
      issuer: "https://test.invalid",
      tokenIdentifier: `test|${accountId}`,
    });

  return { backend, asAccount };
}
