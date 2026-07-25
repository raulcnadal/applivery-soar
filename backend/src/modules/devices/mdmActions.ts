/**
 * Faithful port of MDM_ACTIONS (main.py:4357) -- extracted programmatically
 * via ast.literal_eval to guarantee an exact, not eyeballed, transcription.
 * See main.py's long module comment above MDM_ACTIONS for the full
 * per-platform gating rationale (Apple supervision, Android
 * cope/device_owner requirements, confirmed-vs-UNCONFIRMED command
 * support, etc.) -- reproduced field-for-field here, not summarized.
 *
 * Execution (`_execute_mdm_action`, main.py:5518) is Phase 4 (Workflows)
 * territory -- this registry only powers the workflow builder's action
 * picker (GET /api/mdm-actions) in this phase; firing an action is wired
 * up when the Workflows engine is ported.
 */

export interface MdmActionField {
  key: string;
  label: string;
  type: string;
  required: boolean;
  placeholder?: string;
  options?: string[];
}

export interface MdmActionDefinition {
  label: string;
  destructive: boolean;
  platforms: string[];
  deploymentModels: Record<string, string[]>;
  fields?: MdmActionField[];
}

export const MDM_ACTIONS: Record<string, MdmActionDefinition> = {
  "syncDevice": {
    "label": "Sync device",
    "destructive": false,
    "platforms": [
      "apple",
      "macos",
      "android",
      "windows",
      "aosp"
    ],
    "deploymentModels": {}
  },
  "lockDevice": {
    "label": "Remote lock",
    "destructive": false,
    "platforms": [
      "apple",
      "macos",
      "android",
      "windows",
      "aosp"
    ],
    "deploymentModels": {
      "android": [
        "device_owner"
      ]
    }
  },
  "clearPasscode": {
    "label": "Reset password",
    "destructive": true,
    "platforms": [
      "apple",
      "macos",
      "android",
      "aosp"
    ],
    "deploymentModels": {
      "android": [
        "device_owner"
      ]
    },
    "fields": [
      {
        "key": "newPassword",
        "label": "New password (Android/AOSP only \u2014 leave blank to just clear it)",
        "type": "password",
        "required": false
      }
    ]
  },
  "rebootDevice": {
    "label": "Restart device",
    "destructive": false,
    "platforms": [
      "apple",
      "macos",
      "android",
      "windows",
      "aosp"
    ],
    "deploymentModels": {
      "apple": [
        "supervised"
      ],
      "macos": [
        "supervised"
      ],
      "android": [
        "device_owner"
      ]
    }
  },
  "clearAppData": {
    "label": "Clear app data",
    "destructive": true,
    "platforms": [
      "android",
      "aosp"
    ],
    "deploymentModels": {},
    "fields": [
      {
        "key": "packageNames",
        "label": "Package names to clear (comma-separated)",
        "type": "text",
        "required": true,
        "placeholder": "com.example.app, com.example.other"
      }
    ]
  },
  "shutdownDevice": {
    "label": "Shut down device",
    "destructive": false,
    "platforms": [
      "apple",
      "macos"
    ],
    "deploymentModels": {
      "apple": [
        "supervised"
      ],
      "macos": [
        "supervised"
      ]
    }
  },
  "wipeDevice": {
    "label": "Erase device",
    "destructive": true,
    "platforms": [
      "apple",
      "macos",
      "windows"
    ],
    "deploymentModels": {
      "macos": [
        "supervised"
      ]
    },
    "fields": [
      {
        "key": "wipeType",
        "label": "Wipe type (Windows only)",
        "type": "select",
        "required": false,
        "options": [
          "default",
          "protected"
        ]
      }
    ]
  },
  "disableDevice": {
    "label": "Disable device",
    "destructive": true,
    "platforms": [
      "android"
    ],
    "deploymentModels": {}
  },
  "enableDevice": {
    "label": "Re-enable device",
    "destructive": false,
    "platforms": [
      "android"
    ],
    "deploymentModels": {}
  },
  "enableLostMode": {
    "label": "Enable Lost Mode",
    "destructive": true,
    "platforms": [
      "apple",
      "android"
    ],
    "deploymentModels": {
      "apple": [
        "supervised"
      ],
      "android": [
        "cope",
        "device_owner"
      ]
    },
    "fields": [
      {
        "key": "message",
        "label": "Message shown on the lock screen",
        "type": "text",
        "required": true,
        "placeholder": "This device is lost. Please contact IT."
      },
      {
        "key": "phoneNumber",
        "label": "Contact phone number (optional)",
        "type": "text",
        "required": false
      },
      {
        "key": "footnote",
        "label": "Organization name / footnote (optional, Apple only)",
        "type": "text",
        "required": false
      }
    ]
  },
  "disableLostMode": {
    "label": "Disable Lost Mode",
    "destructive": false,
    "platforms": [
      "apple",
      "android"
    ],
    "deploymentModels": {
      "apple": [
        "supervised"
      ],
      "android": [
        "cope",
        "device_owner"
      ]
    }
  },
  "playLostModeSound": {
    "label": "Play sound (Lost Mode)",
    "destructive": false,
    "platforms": [
      "apple"
    ],
    "deploymentModels": {
      "apple": [
        "supervised"
      ]
    }
  },
  "setTimeZone": {
    "label": "Set Time Zone",
    "destructive": false,
    "platforms": [
      "apple"
    ],
    "deploymentModels": {
      "apple": [
        "supervised"
      ]
    },
    "fields": [
      {
        "key": "timeZone",
        "label": "IANA time zone name",
        "type": "text",
        "required": true,
        "placeholder": "America/New_York"
      }
    ]
  },
  "setBluetooth": {
    "label": "Set Bluetooth (allow/prevent)",
    "destructive": false,
    "platforms": [
      "apple",
      "macos"
    ],
    "deploymentModels": {
      "apple": [
        "supervised"
      ],
      "macos": [
        "supervised"
      ]
    },
    "fields": [
      {
        "key": "enabled",
        "label": "Bluetooth",
        "type": "select",
        "required": true,
        "options": [
          "Enabled",
          "Disabled"
        ]
      }
    ]
  },
  "setDataRoaming": {
    "label": "Set Data Roaming (allow/prevent)",
    "destructive": false,
    "platforms": [
      "apple"
    ],
    "deploymentModels": {},
    "fields": [
      {
        "key": "enabled",
        "label": "Data roaming",
        "type": "select",
        "required": true,
        "options": [
          "Enabled",
          "Disabled"
        ]
      }
    ]
  },
  "setVoiceRoaming": {
    "label": "Set Voice Roaming (allow/prevent, deprecated iOS 16+)",
    "destructive": false,
    "platforms": [
      "apple"
    ],
    "deploymentModels": {},
    "fields": [
      {
        "key": "enabled",
        "label": "Voice roaming",
        "type": "select",
        "required": true,
        "options": [
          "Enabled",
          "Disabled"
        ]
      }
    ]
  },
  "setPersonalHotspot": {
    "label": "Set Personal Hotspot (allow/prevent)",
    "destructive": false,
    "platforms": [
      "apple"
    ],
    "deploymentModels": {},
    "fields": [
      {
        "key": "enabled",
        "label": "Personal Hotspot",
        "type": "select",
        "required": true,
        "options": [
          "Enabled",
          "Disabled"
        ]
      }
    ]
  },
  "setSoftwareUpdateCadence": {
    "label": "Set Software Update recommendation",
    "destructive": false,
    "platforms": [
      "apple"
    ],
    "deploymentModels": {
      "apple": [
        "supervised"
      ]
    },
    "fields": [
      {
        "key": "cadence",
        "label": "Which update(s) to recommend",
        "type": "select",
        "required": true,
        "options": [
          "Show all available",
          "Prefer oldest available",
          "Prefer latest available"
        ]
      }
    ]
  },
  "recoveryLock": {
    "label": "Set Recovery Lock (Apple Silicon Mac only)",
    "destructive": false,
    "platforms": [
      "macos"
    ],
    "deploymentModels": {},
    "fields": [
      {
        "key": "newPassword",
        "label": "New Recovery Lock password (leave blank to clear it)",
        "type": "password",
        "required": false
      },
      {
        "key": "currentPassword",
        "label": "Current Recovery Lock password (only if one is already set)",
        "type": "password",
        "required": false
      }
    ]
  },
  "unlockUserAccount": {
    "label": "Unlock User Account",
    "destructive": false,
    "platforms": [
      "macos"
    ],
    "deploymentModels": {},
    "fields": [
      {
        "key": "userName",
        "label": "Local macOS account username",
        "type": "text",
        "required": true
      }
    ]
  },
  "clearRestrictionsPassword": {
    "label": "Clear Restrictions Password",
    "destructive": false,
    "platforms": [
      "apple"
    ],
    "deploymentModels": {
      "apple": [
        "supervised"
      ]
    }
  },
  "deviceLocation": {
    "label": "Request Device Location",
    "destructive": false,
    "platforms": [
      "apple"
    ],
    "deploymentModels": {
      "apple": [
        "supervised"
      ]
    }
  },
  "scheduleOsUpdate": {
    "label": "Schedule OS update",
    "destructive": true,
    "platforms": [
      "apple",
      "macos"
    ],
    "deploymentModels": {
      "apple": [
        "supervised"
      ],
      "macos": [
        "supervised"
      ]
    },
    "fields": [
      {
        "key": "productVersion",
        "label": "Target OS version",
        "type": "text",
        "required": true,
        "placeholder": "e.g. 17.5.1, or {{ device.osLifecycleStatus.latestKnownVersion }} to auto-resolve per device"
      },
      {
        "key": "installAction",
        "label": "Install action",
        "type": "select",
        "required": true,
        "options": [
          "Default",
          "DownloadOnly",
          "InstallASAP",
          "NotifyOnly",
          "InstallLater",
          "InstallForceRestart"
        ]
      }
    ]
  },
  "setRemoteDesktop": {
    "label": "Set Remote Desktop (Apple Remote Desktop / ARD)",
    "destructive": false,
    "platforms": [
      "macos"
    ],
    "deploymentModels": {
      "macos": [
        "supervised"
      ]
    },
    "fields": [
      {
        "key": "enabled",
        "label": "Remote Desktop",
        "type": "select",
        "required": true,
        "options": [
          "Enabled",
          "Disabled"
        ]
      }
    ]
  },
  "removeProfile": {
    "label": "Remove Configuration Profile (e.g. disconnect a Wi-Fi network)",
    "destructive": true,
    "platforms": [
      "apple",
      "macos"
    ],
    "deploymentModels": {},
    "fields": [
      {
        "key": "identifier",
        "label": "Profile identifier (PayloadIdentifier) to remove",
        "type": "text",
        "required": true,
        "placeholder": "com.yourorg.wifi.corp"
      }
    ]
  },
  "getActivationLockBypassCode": {
    "label": "Get Activation Lock bypass code",
    "destructive": false,
    "platforms": [
      "apple",
      "macos"
    ],
    "deploymentModels": {
      "apple": [
        "supervised"
      ],
      "macos": [
        "supervised"
      ]
    }
  },
  "rotateFileVaultKey": {
    "label": "Rotate FileVault recovery key (invalidates old key; new key isn't retrievable)",
    "destructive": true,
    "platforms": [
      "macos"
    ],
    "deploymentModels": {},
    "fields": [
      {
        "key": "currentPassword",
        "label": "Current FileVault password (if one is required to authorize)",
        "type": "password",
        "required": false
      }
    ]
  },
  "setBluetoothWindows": {
    "label": "Bluetooth \u2014 allow/block",
    "destructive": false,
    "platforms": [
      "windows"
    ],
    "deploymentModels": {},
    "fields": [
      {
        "key": "enabled",
        "label": "Bluetooth",
        "type": "select",
        "required": true,
        "options": [
          "Allow",
          "Block"
        ]
      }
    ]
  },
  "setWifiWindows": {
    "label": "Wi-Fi \u2014 allow/block",
    "destructive": true,
    "platforms": [
      "windows"
    ],
    "deploymentModels": {},
    "fields": [
      {
        "key": "enabled",
        "label": "Wi-Fi",
        "type": "select",
        "required": true,
        "options": [
          "Allow",
          "Block"
        ]
      }
    ]
  },
  "setCameraWindows": {
    "label": "Camera \u2014 allow/block",
    "destructive": false,
    "platforms": [
      "windows"
    ],
    "deploymentModels": {},
    "fields": [
      {
        "key": "enabled",
        "label": "Camera",
        "type": "select",
        "required": true,
        "options": [
          "Allow",
          "Block"
        ]
      }
    ]
  },
  "setRemovableStorageWindows": {
    "label": "External storage (USB / DVD / portable devices) \u2014 block all / allow",
    "destructive": true,
    "platforms": [
      "windows"
    ],
    "deploymentModels": {},
    "fields": [
      {
        "key": "enabled",
        "label": "External storage",
        "type": "select",
        "required": true,
        "options": [
          "Allow",
          "Block all"
        ]
      }
    ]
  },
  "customOmaUri": {
    "label": "Custom OMA-URI command",
    "destructive": false,
    "platforms": [
      "windows"
    ],
    "deploymentModels": {},
    "fields": [
      {
        "key": "path",
        "label": "OMA-URI / CSP path",
        "type": "text",
        "required": true,
        "placeholder": "./Vendor/MSFT/Policy/Config/..."
      },
      {
        "key": "action",
        "label": "Action",
        "type": "select",
        "required": true,
        "options": [
          "Add",
          "Replace",
          "Delete",
          "Exec",
          "Get",
          "Copy"
        ]
      },
      {
        "key": "value",
        "label": "Value (optional)",
        "type": "text",
        "required": false
      },
      {
        "key": "format",
        "label": "Format",
        "type": "select",
        "required": true,
        "options": [
          "chr",
          "int",
          "bool",
          "xml",
          "b64",
          "bin",
          "node",
          "null",
          "date",
          "time",
          "float"
        ]
      }
    ]
  },
  "enableVbsWindows": {
    "label": "Virtualization-Based Security (VBS) \u2014 enable/disable",
    "destructive": false,
    "platforms": [
      "windows"
    ],
    "deploymentModels": {},
    "fields": [
      {
        "key": "enabled",
        "label": "VBS",
        "type": "select",
        "required": true,
        "options": [
          "Enable",
          "Disable"
        ]
      }
    ]
  },
  "setCredentialGuardWindows": {
    "label": "Credential Guard (LSA protection)",
    "destructive": true,
    "platforms": [
      "windows"
    ],
    "deploymentModels": {},
    "fields": [
      {
        "key": "mode",
        "label": "Mode",
        "type": "select",
        "required": true,
        "options": [
          "Disabled",
          "Enabled without lock (recommended for UEM)",
          "Enabled with UEFI lock"
        ]
      }
    ]
  },
  "mdmUnenrollWindows": {
    "label": "MDM Unenroll (remove management, keep user data)",
    "destructive": true,
    "platforms": [
      "windows"
    ],
    "deploymentModels": {},
    "fields": [
      {
        "key": "providerId",
        "label": "MDM Provider ID",
        "type": "text",
        "required": true,
        "placeholder": "Your UEM's enrollment ProviderID"
      }
    ]
  },
  "autopilotResetWindows": {
    "label": "Autopilot Reset (wipe data, keep enrollment)",
    "destructive": true,
    "platforms": [
      "windows"
    ],
    "deploymentModels": {},
    "fields": []
  },
  "runScript": {
    "label": "Run script (direct, on-device execution)",
    "destructive": true,
    "platforms": [
      "windows",
      "macos"
    ],
    "deploymentModels": {},
    "fields": [
      {
        "key": "libraryId",
        "label": "Script (from Script & OMA-URI Library)",
        "type": "script_library_select",
        "required": true
      },
      {
        "key": "restoreLibraryId",
        "label": "Restore/rollback script \u2014 run automatically when compliance recovers (optional)",
        "type": "script_library_select",
        "required": false
      }
    ]
  },
  "applyFirewallRuleSet": {
    "label": "Apply Firewall Rule Set (Windows)",
    "destructive": true,
    "platforms": [
      "windows"
    ],
    "deploymentModels": {},
    "fields": [
      {
        "key": "ruleSetId",
        "label": "Firewall Rule Set (from Firewall Policy Library)",
        "type": "firewall_ruleset_select",
        "required": true
      }
    ]
  },
  "restoreFirewallRuleSet": {
    "label": "Restore Firewall (remove rule set, Windows)",
    "destructive": false,
    "platforms": [
      "windows"
    ],
    "deploymentModels": {},
    "fields": [
      {
        "key": "ruleSetId",
        "label": "Firewall Rule Set to remove",
        "type": "firewall_ruleset_select",
        "required": true
      }
    ]
  },
  "deleteDevice": {
    "label": "Remove from MDM (unenroll / disenroll)",
    "destructive": true,
    "platforms": [
      "apple",
      "macos",
      "android",
      "windows",
      "aosp"
    ],
    "deploymentModels": {}
  },
  "installApp": {
    "label": "Install app",
    "destructive": false,
    "platforms": [
      "apple",
      "macos",
      "android",
      "windows"
    ],
    "deploymentModels": {},
    "fields": [
      {
        "key": "appId",
        "label": "Application",
        "type": "app_select",
        "required": true
      }
    ]
  },
  "uninstallApp": {
    "label": "Uninstall / remove app",
    "destructive": true,
    "platforms": [
      "apple",
      "macos",
      "android",
      "windows"
    ],
    "deploymentModels": {},
    "fields": [
      {
        "key": "appId",
        "label": "Application",
        "type": "app_select",
        "required": true
      }
    ]
  }
};

export const MDM_ACTION_KEYS = Object.keys(MDM_ACTIONS) as Array<keyof typeof MDM_ACTIONS>;
