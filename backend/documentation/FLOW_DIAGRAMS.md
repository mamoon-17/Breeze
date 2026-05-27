# Breeze Authentication & Security Flow Diagrams

This document contains high-fidelity visual representations of the core authentication, session management, token blacklisting, and anomaly detection flows implemented in **Breeze**. 

These diagrams are written using [Mermaid.js](https://mermaid.js.org/) syntax, which renders natively in modern markdown viewers (such as GitHub, VS Code, and GitLab).

---

## Table of Contents
1. [Core Token Lifecycle Overview](#1-core-token-lifecycle-overview)
2. [Token Verification & Access Blacklist Guard](#2-token-verification--access-blacklist-guard)
3. [Token Refresh Flow & Dynamic Anomaly Detection](#3-token-refresh-flow--dynamic-anomaly-detection)
4. [Session Logout & Revocation Channels](#4-session-logout--revocation-channels)
5. [Step-Up Authentication Flow](#5-step-up-authentication-flow)

---

## 1. Core Token Lifecycle Overview

This high-level overview shows how a client initiates a session via Google OAuth, maintains it via short-lived access tokens and token rotation, and eventually terminates the session safely.

```mermaid
flowchart TD
    %% Styling Configuration
    classDef default fill:#1e1e2e,stroke:#cba6f7,stroke-width:2px,color:#cdd6f4;
    classDef start fill:#a6e3a1,stroke:#a6e3a1,stroke-width:2px,color:#11111b;
    classDef decision fill:#f9e2af,stroke:#f9e2af,stroke-width:2px,color:#11111b;
    classDef danger fill:#f38ba8,stroke:#f38ba8,stroke-width:2px,color:#11111b;
    classDef success fill:#89b4fa,stroke:#89b4fa,stroke-width:2px,color:#11111b;
    classDef process fill:#313244,stroke:#cba6f7,stroke-width:1px,color:#cdd6f4;

    Start([User Logs In via Google OAuth]) --> IssueFirst[Issue Access Token + Refresh Token]:::process
    IssueFirst --> AccessRoutes[Client accesses API routes with Access Token]:::process
    AccessRoutes --> CheckExp{Is Access Token Expired?}:::decision
    
    CheckExp -- "No (Valid)" --> AccessRoutes
    CheckExp -- "Yes" --> TriggerRefresh[Client requests Token Refresh]:::process
    
    TriggerRefresh --> ProcessRefresh{Refresh Request Valid?}:::decision
    ProcessRefresh -- "No (Revoked/Reuse)" --> EndSession([Session Terminated / Redirect to Login]):::danger
    ProcessRefresh -- "Yes (Rotated)" --> AccessRoutes
    
    AccessRoutes --> UserLogsOut[User clicks Logout]:::process
    UserLogsOut --> Revoke[Revoke DB Sessions + Blacklist Tokens]:::process
    Revoke --> EndSession
```

---

## 2. Token Verification & Access Blacklist Guard

Every time a client makes a request to a route protected by the `JwtAuthGuard`, the backend validates the signature, check if it's expired, and then checks the global **Redis Blacklist** by its `jti` (JWT ID). This gives stateless JWTs immediate, stateful revocability on demand.

```mermaid
flowchart TD
    %% Styling Configuration
    classDef default fill:#1e1e2e,stroke:#cba6f7,stroke-width:2px,color:#cdd6f4;
    classDef start fill:#a6e3a1,stroke:#a6e3a1,stroke-width:2px,color:#11111b;
    classDef decision fill:#f9e2af,stroke:#f9e2af,stroke-width:2px,color:#11111b;
    classDef danger fill:#f38ba8,stroke:#f38ba8,stroke-width:2px,color:#11111b;
    classDef success fill:#89b4fa,stroke:#89b4fa,stroke-width:2px,color:#11111b;
    classDef process fill:#313244,stroke:#cba6f7,stroke-width:1px,color:#cdd6f4;

    Request([Client API Request]) --> JWTGuard[JWT Guard Extracts Access Token]:::process
    JWTGuard --> VerifySig{Verify Signature & Expiration}:::decision
    
    VerifySig -- "Invalid or Expired" --> Return401_1[Return 401 Unauthorized]:::danger
    VerifySig -- "Valid" --> ExtractPayload[Extract Payload & jti]:::process
    
    ExtractPayload --> CheckBlacklist{Check Redis Blacklist by JTI}:::decision
    CheckBlacklist -- "Err / Connection Failed" --> Return401_2[Return 401: Token Validation Failed]:::danger
    CheckBlacklist -- "Found in Blacklist" --> Return401_3[Return 401: Token Has Been Revoked]:::danger
    CheckBlacklist -- "Not Found" --> FindUser[Find User in DB by uid]:::process
    
    FindUser --> UserExists{User Exists in DB?}:::decision
    UserExists -- "No" --> Return401_4[Return 401: User Not Found]:::danger
    UserExists -- "Yes" --> PassToController[Attach User to Request & Allow Route Access]:::success
```

---

## 3. Token Refresh Flow & Dynamic Anomaly Detection

This flowchart outlines the token refresh process (`AuthService.refreshTokens`), where the system performs validation checks, reuse detection, and computes the risk score of the current request if **Anomaly Detection** is enabled.

```mermaid
flowchart TD
    %% Styling Configuration
    classDef default fill:#1e1e2e,stroke:#cba6f7,stroke-width:2px,color:#cdd6f4;
    classDef start fill:#a6e3a1,stroke:#a6e3a1,stroke-width:2px,color:#11111b;
    classDef decision fill:#f9e2af,stroke:#f9e2af,stroke-width:2px,color:#11111b;
    classDef danger fill:#f38ba8,stroke:#f38ba8,stroke-width:2px,color:#11111b;
    classDef success fill:#89b4fa,stroke:#89b4fa,stroke-width:2px,color:#11111b;
    classDef process fill:#313244,stroke:#cba6f7,stroke-width:1px,color:#cdd6f4;

    Start([Client Request: Refresh Tokens]) --> Extract[Extract sid, uid, and clientInfo]
    Extract --> ValPayload{"Is Payload Valid?"}:::decision
    
    ValPayload -- "No" --> LogFail1[Log Failure: Invalid Payload]:::danger --> Err401[Return 401 Unauthorized]:::danger
    ValPayload -- "Yes" --> FindSession[Find Session in DB]:::process
    
    FindSession --> SessionExists{"Session Found?"}:::decision
    SessionExists -- "No" --> LogFail2[Log Failure: Session Not Found]:::danger --> Err401
    
    SessionExists -- "Yes" --> CheckSpent{"Is Session Spent?<br/>(replacedBySessionId or rotatedAt set)"}:::decision
    CheckSpent -- "Yes" --> ReuseAlert[REUSE DETECTED!]:::danger --> RevokeFamilyReuse[Revoke entire Session Family in DB]:::process --> BlacklistTokensReuse[Blacklist Family Access Tokens in Redis]:::process --> LogFailReuse[Log Failure: Token Reuse]:::danger --> Err401
    
    CheckSpent -- "No" --> CheckStatus{"Is Session Revoked or Expired?"}:::decision
    CheckStatus -- "Yes" --> LogFail3[Log Failure: Revoked/Expired]:::danger --> Err401
    CheckStatus -- "No" --> VerifyHash{"Does Refresh Token Hash Match?"}:::decision
    
    VerifyHash -- "No" --> LogFail4[Log Failure: Hash Mismatch]:::danger --> Err401
    VerifyHash -- "Yes" --> CheckAnomalyConfig{"Is Anomaly Detection Enabled?"}:::decision
    
    CheckAnomalyConfig -- "No" --> RotateSession[Rotate Session & Issue Tokens]:::process
    CheckAnomalyConfig -- "Yes" --> AssessRisk[Call AnomalyDetectionService.assessRisk]:::process
    
    AssessRisk --> GetPrevEvent[Retrieve Last Successful Family Event]:::process
    GetPrevEvent --> CalculateScore[Calculate Risk Score based on Context]:::process
    
    subgraph ScoreCalculation["Risk Scoring Engine Weights"]
        direction TB
        S1["Impossible Travel (+80)"]
        S2["Country Changed (+40)"]
        S3["User Agent Changed (+20)"]
        S4["Rapid Refreshes (+30)"]
        S5["Unusual Hour 2-5 AM UTC (+10)"]
        S6["VPN/Proxy Detected (Reduces HIGH risk to MEDIUM Step-up)"]
    end
    
    CalculateScore --> GetRiskLevel{"Risk Score Category?"}:::decision
    
    GetRiskLevel -- "LOW (< 30)" --> LogLowRisk[Log LOW Risk Level]:::process --> RotateSession
    
    GetRiskLevel -- "MEDIUM (30-59)" --> LogMedRisk[Log MEDIUM Risk Level]:::process --> StepUpFlag[Set requiresStepUp = true on Session]:::process --> ShortTTL[Override Access Token TTL to 2m]:::process --> AlertEmail[Send Async Suspicious Activity Alert Email]:::process --> RotateSession
    
    GetRiskLevel -- "HIGH (>= 60)" --> LogHighRisk[Log HIGH Risk Level]:::danger --> RevokeFamilyHigh[Revoke entire Session Family in DB]:::process --> BlacklistTokensHigh[Blacklist Family Access Tokens in Redis]:::process --> ForcedEmail[Send Forced Logout Email]:::process --> ErrHighRisk[Return 401 Unauthorized: High Risk]:::danger
    
    RotateSession --> UpdateOldSession[DB Transaction: Update Old Session as Spent & Revoked]:::process
    UpdateOldSession --> InsertNewSession[DB Transaction: Insert New Session with New JTI & Hash]:::process
    InsertNewSession --> LogSuccessEvent[Log Successful Refresh Event in DB]:::process
    LogSuccessEvent --> ReturnTokens([Return New Access & Refresh Tokens]):::success
```

---

## 4. Session Logout & Revocation Channels

There are three key revocation mechanisms designed to destroy active sessions. All paths handle DB updates (marking session rows with a `revokedAt` timestamp) and Redis blacklisting (using access token `jti` values to guarantee instant rejection by the `JwtStrategy`).

```mermaid
flowchart TD
    %% Styling Configuration
    classDef default fill:#1e1e2e,stroke:#cba6f7,stroke-width:2px,color:#cdd6f4;
    classDef start fill:#a6e3a1,stroke:#a6e3a1,stroke-width:2px,color:#11111b;
    classDef decision fill:#f9e2af,stroke:#f9e2af,stroke-width:2px,color:#11111b;
    classDef danger fill:#f38ba8,stroke:#f38ba8,stroke-width:2px,color:#11111b;
    classDef success fill:#89b4fa,stroke:#89b4fa,stroke-width:2px,color:#11111b;
    classDef process fill:#313244,stroke:#cba6f7,stroke-width:1px,color:#cdd6f4;

    subgraph LogoutPaths["Logout & Revocation entrypoints"]
        direction LR
        Path1["POST /auth/logout<br/>(Uses Refresh Token)"]:::process
        Path2["POST /auth/logout-all<br/>(Uses Access Token)"]:::process
        Path3["Session Revocation<br/>(Family revocation or HIGH risk)"]:::process
    end

    %% Path 1 Flow
    Path1 --> VerifyRefSession[Verify Active Refresh Session in DB]:::process
    VerifyRefSession --> BlacklistSessionAccess[Blacklist session's currentAccessTokenJti in Redis]:::process
    BlacklistSessionAccess --> RevokeSingleSession[Update revokedAt = now for single session in DB]:::process
    RevokeSingleSession --> ClearCookies1[Clear Client Cookies & Return 200]:::success

    %% Path 2 Flow
    Path2 --> GetAccessJti[Extract current JTI & uid from Access Token]:::process
    GetAccessJti --> FindActiveSessions[Find all active refresh sessions for user in DB]:::process
    FindActiveSessions --> BlacklistAllAccess[Blacklist all active session JTIs + current JTI in Redis]:::process
    BlacklistAllAccess --> RevokeAllUserSessions[Update revokedAt = now for all user sessions in DB]:::process
    RevokeAllUserSessions --> ClearCookies2[Clear Client Cookies & Return 200]:::success

    %% Path 3 Flow
    Path3 --> FindFamilySessions[Find active sessions within target familyId in DB]:::process
    FindFamilySessions --> CollectFamilyJtis[Collect currentAccessTokenJti for all family sessions]:::process
    CollectFamilyJtis --> BlacklistFamilyJtis[Blacklist collected JTIs in Redis]:::process
    BlacklistFamilyJtis --> RevokeFamilySessions[Update revokedAt = now for all family sessions in DB]:::process
    RevokeFamilySessions --> CompleteRevocation[End session chain / Logout family]:::success
```

---

## 5. Step-Up Authentication Flow

If a refresh request triggers **MEDIUM** risk (`30-59` score), the user gets a short-lived access token (default 2 minutes) and has their session marked with `requiresStepUp = true`. When accessing sensitive APIs, they must re-verify their identity via Google OAuth to clear this requirement.

```mermaid
flowchart TD
    %% Styling Configuration
    classDef default fill:#1e1e2e,stroke:#cba6f7,stroke-width:2px,color:#cdd6f4;
    classDef start fill:#a6e3a1,stroke:#a6e3a1,stroke-width:2px,color:#11111b;
    classDef decision fill:#f9e2af,stroke:#f9e2af,stroke-width:2px,color:#11111b;
    classDef danger fill:#f38ba8,stroke:#f38ba8,stroke-width:2px,color:#11111b;
    classDef success fill:#89b4fa,stroke:#89b4fa,stroke-width:2px,color:#11111b;
    classDef process fill:#313244,stroke:#cba6f7,stroke-width:1px,color:#cdd6f4;

    Trigger[MEDIUM Risk detected during Refresh] --> SetStepUpFlag[Set requiresStepUp = true on Session in DB]:::process
    SetStepUpFlag --> ShortAccess[Issue short-lived Access Token <br/> TTL = 2 mins]:::process
    ShortAccess --> AsyncEmail[Send Suspicious Activity Alert Email]:::process
    
    AsyncEmail --> NormalRequest[Client accesses sensitive route]:::process
    NormalRequest --> StepUpGuard[StepUpRequiredGuard checks requiresStepUp status]:::process
    
    StepUpGuard --> IsStepUpRequired{"Is requiresStepUp == true?"}:::decision
    IsStepUpRequired -- "No" --> GrantAccess[Grant Access to sensitive route]:::success
    IsStepUpRequired -- "Yes" --> BlockRequest[Block Request & Return 403 / Step-Up Required]:::danger
    
    BlockRequest --> StartStepUp[Client redirects user to GET /auth/step-up]:::process
    StartStepUp --> OAuthReauth[User completes Google OAuth re-authentication]:::process
    OAuthReauth --> OAuthCallback[Google redirects to GET /auth/step-up/callback]:::process
    
    OAuthCallback --> ClearFlag[Set requiresStepUp = false on Session in DB]:::process
    ClearFlag --> IssueNewTokens[Issue new Access Token with full TTL]:::success
    IssueNewTokens --> ResumeSensitive[Client accesses sensitive route successfully]:::success
```
