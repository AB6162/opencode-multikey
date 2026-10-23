import { Rpc } from "@opencode/plugin/rpc"

const emptyObject = {
  type: "object",
  properties: {},
  additionalProperties: false,
} as const

const accountStatus = {
  type: "object",
  properties: {
    credentialID: { type: "string" },
    label: { type: "string" },
    priority: { type: "number" },
    preferred: { type: "boolean" },
    nativeActive: { type: "boolean" },
    enabled: { type: "boolean" },
    healthy: { type: "boolean" },
    healthReason: { type: "string" },
    authInvalid: { type: "boolean" },
    failures: { type: "number" },
    cooldownUntil: { type: "number" },
    cooldownReason: { type: "string" },
    lastStatus: { type: "number" },
    lastErrorType: { type: "string" },
    lastErrorMessage: { type: "string" },
    quota: {
      type: "array",
      items: {
        type: "object",
        properties: {
          modelID: { type: "string" },
          until: { type: "number" },
          reason: { type: "string" },
        },
        required: ["modelID", "until", "reason"],
        additionalProperties: false,
      },
    },
  },
  required: [
    "credentialID",
    "label",
    "priority",
    "preferred",
    "nativeActive",
    "enabled",
    "healthy",
    "authInvalid",
    "failures",
    "quota",
  ],
  additionalProperties: false,
} as const

const statusOutput = {
  type: "object",
  properties: {
    providerID: { type: "string" },
    integrationID: { type: "string" },
    providerName: { type: "string" },
    integrationName: { type: "string" },
    balancingEnabled: { type: "boolean" },
    strategy: { type: "string" },
    syncActive: { type: "boolean" },
    diagnostics: { type: "boolean" },
    selectedCredentialID: { type: "string" },
    nativeActiveCredentialID: { type: "string" },
    accounts: { type: "array", items: accountStatus },
  },
  required: [
    "providerID",
    "providerName",
    "integrationName",
    "balancingEnabled",
    "strategy",
    "syncActive",
    "diagnostics",
    "accounts",
  ],
  additionalProperties: false,
} as const

const targetSummary = {
  type: "object",
  properties: {
    providerID: { type: "string" },
    integrationID: { type: "string" },
    providerName: { type: "string" },
    integrationName: { type: "string" },
    accountCount: { type: "number" },
  },
  required: [
    "providerID",
    "integrationID",
    "providerName",
    "integrationName",
    "accountCount",
  ],
  additionalProperties: false,
} as const

const diagnosticEntry = {
  type: "object",
  properties: {
    id: { type: "string" },
    at: { type: "number" },
    integrationID: { type: "string" },
    credentialID: { type: "string" },
    label: { type: "string" },
    modelID: { type: "string" },
    status: { type: "number" },
    errorType: { type: "string" },
    message: { type: "string" },
    body: { type: "string" },
    window: { type: "string" },
    cooldownUntil: { type: "number" },
  },
  required: [
    "id",
    "at",
    "integrationID",
    "credentialID",
    "label",
    "modelID",
    "errorType",
    "message",
  ],
  additionalProperties: false,
} as const

export const MultikeyRpc = Rpc.define({
  id: "opencode-multikey",
  methods: {
    status: {
      input: {
        type: "object",
        properties: {
          providerID: { type: "string" },
          modelID: { type: "string" },
        },
        additionalProperties: false,
      },
      output: statusOutput,
    },
    targets: {
      input: emptyObject,
      output: {
        type: "object",
        properties: {
          targets: { type: "array", items: targetSummary },
        },
        required: ["targets"],
        additionalProperties: false,
      },
    },
    setPriority: {
      input: {
        type: "object",
        properties: {
          providerID: { type: "string" },
          credentialIDs: { type: "array", items: { type: "string" } },
        },
        required: ["credentialIDs"],
        additionalProperties: false,
      },
      output: emptyObject,
    },
    use: {
      input: {
        type: "object",
        properties: {
          providerID: { type: "string" },
          credentialID: { type: "string" },
          modelID: { type: "string" },
        },
        required: ["credentialID"],
        additionalProperties: false,
      },
      output: emptyObject,
    },
    setEnabled: {
      input: {
        type: "object",
        properties: {
          providerID: { type: "string" },
          credentialID: { type: "string" },
          enabled: { type: "boolean" },
        },
        required: ["credentialID", "enabled"],
        additionalProperties: false,
      },
      output: emptyObject,
    },
    resetCooldown: {
      input: {
        type: "object",
        properties: {
          providerID: { type: "string" },
          credentialID: { type: "string" },
          modelID: { type: "string" },
        },
        required: ["credentialID"],
        additionalProperties: false,
      },
      output: emptyObject,
    },
    markCooldown: {
      input: {
        type: "object",
        properties: {
          providerID: { type: "string" },
          credentialID: { type: "string" },
          modelID: { type: "string" },
          reason: {
            type: "string",
            enum: [
              "five_hour",
              "weekly",
              "monthly",
              "billing",
              "rate-limit",
              "server-error",
            ],
          },
          durationMs: { type: "number" },
        },
        required: ["credentialID", "reason"],
        additionalProperties: false,
      },
      output: emptyObject,
    },
    setSettings: {
      input: {
        type: "object",
        properties: {
          balancingEnabled: { type: "boolean" },
          syncActive: { type: "boolean" },
          diagnostics: { type: "boolean" },
          toast: { type: "boolean" },
        },
        additionalProperties: false,
      },
      output: emptyObject,
    },
    diagnostics: {
      input: {
        type: "object",
        properties: {
          providerID: { type: "string" },
          limit: { type: "number" },
        },
        additionalProperties: false,
      },
      output: {
        type: "object",
        properties: {
          entries: { type: "array", items: diagnosticEntry },
        },
        required: ["entries"],
        additionalProperties: false,
      },
    },
    refresh: {
      input: {
        type: "object",
        properties: {
          providerID: { type: "string" },
        },
        additionalProperties: false,
      },
      output: emptyObject,
    },
  },
  events: {
    updated: {
      schema: {
        type: "object",
        properties: {
          providerID: { type: "string" },
          integrationID: { type: "string" },
          kind: { type: "string" },
          from: { type: "string" },
          to: { type: "string" },
          modelID: { type: "string" },
          reason: { type: "string" },
          until: { type: "number" },
          toast: { type: "boolean" },
        },
        additionalProperties: false,
      },
    },
  },
})
