; Pages et etapes personnalisees de l'installateur Windows (electron-builder).
;
; Option JARVIS : page avec une case a cocher affichee avant l'installation.
; Si elle est cochee, on ecrit "1|<date>" dans le registre ; l'application lit
; cette valeur au demarrage (src/main/jarvis.js) et lance la cinematique.
; Les mises a jour automatiques (installation silencieuse) ne montrent pas la
; page et ne touchent pas a la valeur.

!include nsDialogs.nsh
!include FileFunc.nsh

!macro customPageAfterChangeDir
  Var JarvisCheckbox
  Var JarvisChoice

  Page custom JarvisPageCreate JarvisPageLeave

  Function JarvisPageCreate
    ${if} ${isUpdated}
      Abort
    ${endif}
    !insertmacro MUI_HEADER_TEXT "Options" "Modules supplementaires"
    nsDialogs::Create 1018
    Pop $0
    ${if} $0 == error
      Abort
    ${endif}

    ${NSD_CreateLabel} 0 0 100% 36u "JARVIS est une refonte de l'interface facon Iron Man, avec des fonctionnalites avancees. Un peu moins rapide que l'interface classique, mais plus fun."
    Pop $0
    ${NSD_CreateCheckbox} 0 46u 100% 12u "Installer JARVIS"
    Pop $JarvisCheckbox
    ${NSD_CreateLabel} 12u 62u 95% 24u "Tu pourras aussi l'installer ou le desinstaller plus tard depuis le bouton JARVIS de l'application (ou le menu Affichage)."
    Pop $0

    ${if} $JarvisChoice == ${BST_CHECKED}
      ${NSD_Check} $JarvisCheckbox
    ${endif}
    nsDialogs::Show
  FunctionEnd

  Function JarvisPageLeave
    ${NSD_GetState} $JarvisCheckbox $JarvisChoice
  FunctionEnd
!macroend

!macro customInstall
  ${ifNot} ${isUpdated}
    ${if} $JarvisChoice == ${BST_CHECKED}
      ${GetTime} "" "L" $0 $1 $2 $3 $4 $5 $6
      SetRegView 64
      WriteRegStr HKLM "Software\IA CLI Launcher" "Jarvis" "1|$2$1$0$4$5$6"
      SetRegView 32
    ${endif}
  ${endif}
!macroend

!macro customUnInstall
  ${ifNot} ${isUpdated}
    SetRegView 64
    DeleteRegValue HKLM "Software\IA CLI Launcher" "Jarvis"
    DeleteRegKey /ifempty HKLM "Software\IA CLI Launcher"
    SetRegView 32
  ${endif}
!macroend
