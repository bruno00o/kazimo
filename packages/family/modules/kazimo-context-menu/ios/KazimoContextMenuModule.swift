import ExpoModulesCore

public final class KazimoContextMenuModule: Module {
  public func definition() -> ModuleDefinition {
    Name("KazimoContextMenu")

    View(KazimoContextMenuView.self) {
      Events("onAction", "onOpen")

      Prop("menuTitle") { (view: KazimoContextMenuView, title: String) in
        view.menuTitle = title
      }

      Prop("actions") { (view: KazimoContextMenuView, actions: [MenuAction]) in
        view.actions = actions
      }
    }
  }
}
