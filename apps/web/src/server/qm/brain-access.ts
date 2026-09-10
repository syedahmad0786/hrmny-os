import {
  readAuthorizedGbrain,
  readAuthorizedProjectGbrain,
} from "../gbrain-access";
import { qmBrainContext } from "./staff-access";

export async function readQmBrain(token: string, input: unknown) {
  if (process.env.QM_BRAIN_ENABLED !== "1")
    throw new Error("QM_BRAIN_NOT_ENABLED");
  const context = await qmBrainContext(token);
  const result =
    context.scope.kind === "project"
      ? await readAuthorizedProjectGbrain(
          context.user.employeeId,
          context.scope.projectId,
          input,
        )
      : await readAuthorizedGbrain(context.user.employeeId, input);
  const current = await qmBrainContext(token);
  if (
    current.user.employeeId !== context.user.employeeId ||
    current.scope.kind !== context.scope.kind ||
    (current.scope.kind === "project" &&
      context.scope.kind === "project" &&
      (current.scope.projectId !== context.scope.projectId ||
        current.scope.revision !== context.scope.revision))
  )
    throw new Error("QM_ACCESS_CHANGED");
  return result;
}
