import type { RuntimeSnapshot } from "@pi-gui/session-driver/runtime-types";
import { translate, type Translate } from "../../i18n/translate";
import { buildModelOptions } from "../conversation/composer-commands";

export type ModelOnboardingSettingsSection = "models" | "providers";

export interface ModelOnboardingNotice {
  readonly title: string;
  readonly description: string;
  readonly actionLabel: string;
  readonly actionSection: ModelOnboardingSettingsSection;
}

export interface ModelOnboardingState {
  readonly hasSelectableModels: boolean;
  readonly requiresModelSelection: boolean;
  readonly unselectedModelLabel: string;
  readonly emptyModelTitle: string;
  readonly emptyModelDescription: string;
  readonly notice?: ModelOnboardingNotice;
}

interface ModelSelectionInput {
  readonly provider: string | undefined;
  readonly modelId: string | undefined;
}

export function deriveModelOnboardingState(
  runtime: RuntimeSnapshot | undefined,
  currentSelection: ModelSelectionInput,
  t: Translate = translate,
): ModelOnboardingState {
  const selectableModels = buildModelOptions(runtime);
  const selectableSet = new Set(
    selectableModels.map((model) => `${model.providerId}:${model.modelId}`),
  );
  const hasSelectableModels = selectableModels.length > 0;
  const connectedProviderCount =
    runtime?.providers.filter((provider) => provider.hasAuth).length ?? 0;
  const settingsDefault = {
    provider: runtime?.settings.defaultProvider,
    modelId: runtime?.settings.defaultModelId,
  };
  const hasDefaultModel = Boolean(settingsDefault.provider && settingsDefault.modelId);
  const defaultModelUsable = isUsableSelection(settingsDefault, selectableSet);
  const hasCurrentSelection = Boolean(currentSelection.provider && currentSelection.modelId);
  const currentSelectionUsable = isUsableSelection(currentSelection, selectableSet);

  if (!hasSelectableModels) {
    return {
      hasSelectableModels: false,
      requiresModelSelection: true,
      unselectedModelLabel: t("composer.model.none"),
      emptyModelTitle: t("composer.model.none"),
      emptyModelDescription:
        connectedProviderCount > 0
          ? t("composer.model.enableHelp")
          : t("composer.model.connectHelp"),
      notice:
        connectedProviderCount > 0
          ? {
              title: t("composer.model.none"),
              description: t("composer.model.allDisabled"),
              actionLabel: t("composer.model.openModels"),
              actionSection: "models",
            }
          : {
              title: t("composer.model.none"),
              description: t("composer.model.connectNotice"),
              actionLabel: t("composer.model.openProviders"),
              actionSection: "providers",
            },
    };
  }

  if (hasCurrentSelection && !currentSelectionUsable) {
    return {
      hasSelectableModels: true,
      requiresModelSelection: true,
      unselectedModelLabel: t("composer.model.pick"),
      emptyModelTitle: t("composer.model.none"),
      emptyModelDescription: t("composer.model.pickHint"),
      notice: {
        title: t("composer.model.selectionUnavailable"),
        description: hasDefaultModel
          ? t("composer.model.selectionUpdate")
          : t("composer.model.selectionSetDefault"),
        actionLabel: t("composer.model.openModels"),
        actionSection: "models",
      },
    };
  }

  if (!hasDefaultModel) {
    return {
      hasSelectableModels: true,
      requiresModelSelection: !currentSelectionUsable,
      unselectedModelLabel: t("composer.model.pick"),
      emptyModelTitle: t("composer.model.noDefault"),
      emptyModelDescription: t("composer.model.pickHint"),
      notice: currentSelectionUsable
        ? undefined
        : {
            title: t("composer.model.noDefault"),
            description: t("composer.model.setDefault"),
            actionLabel: t("composer.model.openModels"),
            actionSection: "models",
          },
    };
  }

  if (!defaultModelUsable) {
    const defaultLabel = `${settingsDefault.provider}:${settingsDefault.modelId}`;
    return {
      hasSelectableModels: true,
      requiresModelSelection: !currentSelectionUsable,
      unselectedModelLabel: t("composer.model.pick"),
      emptyModelTitle: t("composer.model.defaultUnavailable"),
      emptyModelDescription: t("composer.model.pickHint"),
      notice: {
        title: t("composer.model.defaultUnavailable"),
        description: currentSelectionUsable
          ? t("composer.model.updateDefault", { name: defaultLabel })
          : t("composer.model.chooseAndUpdate", { name: defaultLabel }),
        actionLabel: t("composer.model.openModels"),
        actionSection: "models",
      },
    };
  }

  return {
    hasSelectableModels: true,
    requiresModelSelection: false,
    unselectedModelLabel: t("composer.model.pick"),
    emptyModelTitle: t("composer.model.none"),
    emptyModelDescription: t("composer.model.pickHint"),
  };
}

function isUsableSelection(
  selection: ModelSelectionInput,
  selectableSet: ReadonlySet<string>,
): boolean {
  return Boolean(
    selection.provider &&
    selection.modelId &&
    selectableSet.has(`${selection.provider}:${selection.modelId}`),
  );
}
