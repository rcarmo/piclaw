// SPDX-License-Identifier: Apache-2.0
import type { ModelRef } from "../types.ts";
export type Sample = {id:string;recordId:string;scope:string;group:string;sessionId:string;at:number;kind:"loop"|"tool";tool:string|null;features:number[];tokens:string[];label:0|1|null;reviewed:boolean;source:"reference"|"audit"|"review";complete:boolean;eligible:boolean;dropEligible?:boolean;uniform:boolean;featureVersion:string;labelPolicy:string;catalogueRevision:string;environmentRevision:string;teacher:ModelRef|null;classifier:ModelRef|null;textScore:number|null};
export type Provenance = {scope:string;featureVersion:string;labelPolicy:string;catalogueRevision:string;environmentRevision:string;teacher:ModelRef|null;backend:ModelRef|null};
export type Band = {threshold:number;direction:"low"|"high";errorLimit:number;selected:number;errors:number;upper:number;reviewed:boolean;approved:boolean};
export type Bands = {spare:Band|null;stuck:Band|null;drop:Band|null};
export type Readiness = "collecting"|"fitted"|"observe_only"|"active_bands"|"invalidated";
export type ArtifactIdentity = {id:string;provenance:Provenance;state:Readiness;fitGroups:string[];selectionGroups:string[];acceptanceGroups:string[];bands:Bands;invalidReason:string|null;vocabulary?:string[];tool?:string|null};
export type ScoredSample = {sample:Sample;score:number};
