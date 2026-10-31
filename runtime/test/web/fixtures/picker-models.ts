import { normaliseModelCatalogue } from "../../../web/src/ui/model-catalogue.ts";
export const pickerModels = normaliseModelCatalogue(
  {
    current: "test/large",
    model_options: [
      {
        label: "test/large",
        provider: "test",
        id: "large",
        name: "Large model",
        context_window: 200000,
      },
      {
        label: "test/small",
        provider: "test",
        id: "small",
        name: "Small model",
        context_window: 8000,
      },
    ],
  },
);
