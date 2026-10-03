!include "MUI.nsh"

!define MUI_FINISHPAGE_LINK_LOCATION "https://github.com/yifulin114514143/MicoMusic/issues"
!define MUI_FINISHPAGE_LINK "反馈 MicoMusic 问题"
!define MUI_FINISHPAGE_SHOWREADME_TEXT "访问 GitHub 项目主页"
!define MUI_FINISHPAGE_SHOWREADME "https://github.com/yifulin114514143/MicoMusic"
!insertmacro MUI_PAGE_WELCOME

!macro customInstall
  SetShellVarContext all
  Delete "$DESKTOP\${PRODUCT_NAME}.lnk"
  SetShellVarContext current
  CreateShortCut "$DESKTOP\${PRODUCT_NAME}.lnk" "$INSTDIR\${PRODUCT_NAME}.exe"
  SetShellVarContext all
!macroend
