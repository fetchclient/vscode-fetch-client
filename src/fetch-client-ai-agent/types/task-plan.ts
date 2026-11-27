import type { RiskLevel } from "./agent-contracts";
import type { PlannedToolName } from "../services/task-plan.schema";

export interface ITaskStep {
	id: number;
	description: string;
	toolName?: PlannedToolName;
	riskLevel: RiskLevel;
}

export interface ITaskPlan {
	goal: string;
	steps: ITaskStep[];
}
