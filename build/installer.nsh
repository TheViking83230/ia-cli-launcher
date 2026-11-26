; Pages et etapes personnalisees de l'installateur Windows (electron-builder).
;
; Habillage : theme sombre aux couleurs du logiciel (fond #0B0D10, texte
; #E8EAEE, accent turquoise), bandeau lateral et en-tete generes par
; build/installer-art.ps1, boutons et barre de titre en mode sombre Windows.
;
; Option JARVIS : page avec une case a cocher affichee avant l'installation.
; Si elle est cochee, on ecrit "1|<date>" dans le registre ; l'application lit
; cette valeur au demarrage (src/main/jarvis.js) et lance la cinematique.
; Les mises a jour automatiques (installation silencieuse) ne montrent pas les
; pages et ne touchent pas a la valeur.

!include nsDialogs.nsh
!include FileFunc.nsh

; --- Couleurs (avant les pages MUI) -------------------------------------------
!define DA_BG "0B0D10"
!define DA_TEXT "E8EAEE"
!define DA_MUTED "8B93A1"
; Couleurs au format Windows (0x00BBGGRR) pour les messages des controles.
!define DA_BG_BGR 0x00100D0B
!define DA_TEXT_BGR 0x00EEEAE8
!define DA_ACCENT_BGR 0x0099D334
!define DA_TRACK_BGR 0x00241C16

!define MUI_BGCOLOR "${DA_BG}"
!define MUI_TEXTCOLOR "${DA_TEXT}"
!define MUI_HEADER_TRANSPARENT_TEXT
BrandingText "IA CLI Launcher"

; Theme sombre Windows sur un controle (boutons, listes, barres de defilement).
!macro DaDarkTheme HWND
  System::Call 'uxtheme::SetWindowTheme(p ${HWND}, w "DarkMode_Explorer", p 0)'
!macroend

; Sans theme : la couleur du texte des cases a cocher devient modifiable.
!macro DaNoTheme HWND
  System::Call 'uxtheme::SetWindowTheme(p ${HWND}, w " ", w " ")'
!macroend

!macro DaStyleWindow PREFIX
  Function ${PREFIX}DaGuiInit
    ; Barre de titre sombre (Windows 10 20H1+ et Windows 11).
    System::Call 'dwmapi::DwmSetWindowAttribute(p $HWNDPARENT, i 20, *i 1, i 4)'
    SetCtlColors $HWNDPARENT ${DA_TEXT} ${DA_BG}
    GetDlgItem $0 $HWNDPARENT 1028
    SetCtlColors $0 ${DA_MUTED} transparent
    GetDlgItem $0 $HWNDPARENT 1256
    SetCtlColors $0 ${DA_MUTED} transparent
    ; Boutons Precedent / Suivant / Annuler.
    GetDlgItem $0 $HWNDPARENT 1
    !insertmacro DaDarkTheme $0
    GetDlgItem $0 $HWNDPARENT 2
    !insertmacro DaDarkTheme $0
    GetDlgItem $0 $HWNDPARENT 3
    !insertmacro DaDarkTheme $0
  FunctionEnd
!macroend

; Page de progression : fond, texte, liste des details et barre turquoise.
!macro DaStyleInstFiles
  Function DaInstFilesShow
    FindWindow $1 "#32770" "" $HWNDPARENT
    SetCtlColors $1 ${DA_TEXT} ${DA_BG}
    GetDlgItem $0 $1 1006
    SetCtlColors $0 ${DA_TEXT} ${DA_BG}
    GetDlgItem $0 $1 1004
    !insertmacro DaNoTheme $0
    SendMessage $0 0x0409 0 ${DA_ACCENT_BGR}
    SendMessage $0 0x2001 0 ${DA_TRACK_BGR}
    GetDlgItem $0 $1 1016
    !insertmacro DaDarkTheme $0
    SendMessage $0 0x1001 0 ${DA_BG_BGR}
    SendMessage $0 0x1026 0 ${DA_BG_BGR}
    SendMessage $0 0x1024 0 ${DA_TEXT_BGR}
    GetDlgItem $0 $1 1027
    !insertmacro DaDarkTheme $0
  FunctionEnd
!macroend

!ifndef BUILD_UNINSTALLER
  !define MUI_CUSTOMFUNCTION_GUIINIT DaGuiInit
  !insertmacro DaStyleWindow ""
  !insertmacro DaStyleInstFiles
!else
  !define MUI_CUSTOMFUNCTION_UNGUIINIT un.DaGuiInit
  !insertmacro DaStyleWindow "un."
!endif

; --- Page de bienvenue ----------------------------------------------------------
!macro customWelcomePage
  !define MUI_WELCOMEPAGE_TITLE "Bienvenue dans IA CLI Launcher"
  !define MUI_WELCOMEPAGE_TEXT "Lance Claude Code, Codex, Gemini et les autres IA en ligne de commande dans des onglets, depuis le dossier de ton choix.$\r$\n$\r$\nTes sessions sont reprises au démarrage, avec une vue chat, le suivi du quota et des thèmes de couleurs.$\r$\n$\r$\nClique sur Suivant pour continuer."
  !define MUI_PAGE_CUSTOMFUNCTION_PRE DaWelcomePre
  !insertmacro MUI_PAGE_WELCOME

  Function DaWelcomePre
    ${if} ${isUpdated}
      Abort
    ${endif}
  FunctionEnd
!macroend

; --- Page JARVIS (avant l'installation) -----------------------------------------
!macro customPageAfterChangeDir
  Var JarvisCheckbox
  Var JarvisChoice

  Page custom JarvisPageCreate JarvisPageLeave

  Function JarvisPageCreate
    ${if} ${isUpdated}
      Abort
    ${endif}
    !insertmacro MUI_HEADER_TEXT "Options" "Modules supplémentaires"
    nsDialogs::Create 1018
    Pop $1
    ${if} $1 == error
      Abort
    ${endif}
    SetCtlColors $1 ${DA_TEXT} ${DA_BG}

    ${NSD_CreateLabel} 0 0 100% 36u "JARVIS est une refonte de l'interface façon Iron Man, avec des fonctionnalités avancées. Un peu moins rapide que l'interface classique, mais plus fun."
    Pop $0
    SetCtlColors $0 ${DA_TEXT} ${DA_BG}
    ${NSD_CreateCheckbox} 0 46u 100% 12u "Installer JARVIS"
    Pop $JarvisCheckbox
    !insertmacro DaNoTheme $JarvisCheckbox
    SetCtlColors $JarvisCheckbox ${DA_TEXT} ${DA_BG}
    ${NSD_CreateLabel} 12u 62u 95% 24u "Tu pourras aussi l'installer ou le désinstaller plus tard depuis le bouton JARVIS de l'application."
    Pop $0
    SetCtlColors $0 ${DA_MUTED} ${DA_BG}

    ${if} $JarvisChoice == ${BST_CHECKED}
      ${NSD_Check} $JarvisCheckbox
    ${endif}
    nsDialogs::Show
  FunctionEnd

  Function JarvisPageLeave
    ${NSD_GetState} $JarvisCheckbox $JarvisChoice
  FunctionEnd

  ; Applique le theme sombre a la page de progression qui suit.
  !define MUI_PAGE_CUSTOMFUNCTION_SHOW DaInstFilesShow
!macroend

; --- Page de fin (reprend celle d'electron-builder, avec le theme) ----------------
!macro customFinishPage
  Function StartApp
    ${if} ${isUpdated}
      StrCpy $1 "--updated"
    ${else}
      StrCpy $1 ""
    ${endif}
    ${StdUtils.ExecShellAsUser} $0 "$launchLink" "open" "$1"
  FunctionEnd

  !define MUI_FINISHPAGE_TITLE "IA CLI Launcher est installé"
  !define MUI_FINISHPAGE_TEXT "Tout est prêt. Choisis un dossier, une IA, et c'est parti.$\r$\n$\r$\nAstuce : Ctrl+T ouvre une nouvelle session, Ctrl+K toutes les actions."
  !define MUI_FINISHPAGE_RUN
  !define MUI_FINISHPAGE_RUN_TEXT "Lancer IA CLI Launcher"
  !define MUI_FINISHPAGE_RUN_FUNCTION "StartApp"
  !define MUI_PAGE_CUSTOMFUNCTION_SHOW DaFinishShow
  !insertmacro MUI_PAGE_FINISH

  Function DaFinishShow
    StrCpy $0 $mui.FinishPage.Run
    !insertmacro DaNoTheme $0
    SetCtlColors $0 ${DA_TEXT} ${DA_BG}
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
