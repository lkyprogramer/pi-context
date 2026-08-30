import {
  PCR_INGRESS_METADATA_CONTRACT,
  type IngressMetadata,
  type InputEvent,
  type InputResultEvent,
  type SessionMessageEntry,
} from "@earendil-works/pi-coding-agent";
import { registerUserInputHook, type UserInputHookDependencies } from "@pcr/pi-adapter";
import {
  createUserTurnService,
  type UserInputReceipt,
  type UserTurnService,
} from "@pcr/runtime";
import {
  createWorkspaceBlobKeyLease,
  openWorkspaceUserTurnLedger,
  type WorkspaceBlobKeyLease,
} from "@pcr/storage-node";

void registerUserInputHook;
void createUserTurnService;
void openWorkspaceUserTurnLedger;
void createWorkspaceBlobKeyLease;
void PCR_INGRESS_METADATA_CONTRACT;
type PublicContracts = [
  InputEvent,
  InputResultEvent,
  IngressMetadata,
  SessionMessageEntry,
  UserInputHookDependencies,
  UserInputReceipt,
  UserTurnService,
  WorkspaceBlobKeyLease,
];
void (null as unknown as PublicContracts);
