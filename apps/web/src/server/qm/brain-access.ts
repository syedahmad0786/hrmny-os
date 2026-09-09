import { readAuthorizedGbrain } from "../gbrain-access";
import { qmStaff } from "./staff-access";

export async function readQmBrain(token: string, input: unknown) {
  if (process.env.QM_BRAIN_ENABLED !== "1")
    throw new Error("QM_BRAIN_NOT_ENABLED");
  const user = await qmStaff(token);
  const result = await readAuthorizedGbrain(user.employeeId, input);
  const current = await qmStaff(token);
  if (current.employeeId !== user.employeeId)
    throw new Error("QM_ACCESS_CHANGED");
  return result;
}
