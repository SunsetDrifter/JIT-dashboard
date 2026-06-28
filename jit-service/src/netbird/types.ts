// Minimal NetBird Management API shapes JIT depends on. Field names match the API.

export type NbGroupIssued = "api" | "integration" | "jwt";

export interface NbUser {
  id: string;
  email?: string;
  name?: string;
  role: string;
  auto_groups: string[];
  is_blocked?: boolean;
  is_service_user?: boolean;
  idp_id?: string;
}

export interface NbGroup {
  id: string;
  name: string;
  issued?: NbGroupIssued;
  peers?: string[] | { id: string; name: string }[];
  resources?: { id: string; type: string }[];
}

export interface NbPolicyRuleResource {
  id: string;
  type?: string;
}

export interface NbPolicyRule {
  name: string;
  description?: string;
  enabled: boolean;
  sources?: string[] | null;
  destinations?: string[] | null;
  sourceResource?: NbPolicyRuleResource;
  destinationResource?: NbPolicyRuleResource;
  bidirectional?: boolean;
  action: "accept" | "drop";
  protocol: "all" | "tcp" | "udp" | "icmp";
  ports?: string[];
}

export interface NbPolicy {
  id?: string;
  name: string;
  description?: string;
  enabled: boolean;
  rules: NbPolicyRule[];
  source_posture_checks?: string[];
}

export interface NbAccountSettings {
  groups_propagation_enabled: boolean;
  jwt_groups_enabled?: boolean;
  [k: string]: unknown;
}

export interface NbAccount {
  id: string;
  settings: NbAccountSettings;
}

export interface NbNetworkResource {
  id: string;
  name: string;
  description?: string;
  address?: string;
  type?: "domain" | "host" | "subnet";
  enabled?: boolean;
}
