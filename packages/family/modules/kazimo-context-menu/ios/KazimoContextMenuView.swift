import ExpoModulesCore
import UIKit

struct MenuAction: Record {
  @Field var key: String = ""
  @Field var title: String = ""
  @Field var systemImage: String?
  @Field var destructive: Bool = false
}

final class KazimoContextMenuView: ExpoView, UIContextMenuInteractionDelegate {
  let onAction = EventDispatcher()
  let onOpen = EventDispatcher()
  var menuTitle = ""
  var actions: [MenuAction] = []

  required init(appContext: AppContext? = nil) {
    super.init(appContext: appContext)
    addInteraction(UIContextMenuInteraction(delegate: self))
  }

  func contextMenuInteraction(
    _ interaction: UIContextMenuInteraction,
    configurationForMenuAtLocation location: CGPoint
  ) -> UIContextMenuConfiguration? {
    onOpen([:])
    return UIContextMenuConfiguration(identifier: nil, previewProvider: nil) { [weak self] _ in
      guard let self else { return nil }
      return UIMenu(title: self.menuTitle, children: self.actions.map(self.uiAction))
    }
  }

  private func uiAction(_ action: MenuAction) -> UIAction {
    let image = action.systemImage.flatMap { UIImage(systemName: $0) }
    let attributes: UIMenuElement.Attributes = action.destructive ? [.destructive] : []
    return UIAction(title: action.title, image: image, attributes: attributes) { [weak self] _ in
      self?.onAction(["key": action.key])
    }
  }
}
