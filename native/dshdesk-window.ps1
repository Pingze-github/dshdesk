param(
  [int]$Port = 0,
  [string]$Token = '',
  [double]$Opacity = 0.9,
  [string]$LogFile = '',
  [switch]$SelfTest
)

$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
$script:LogFile = $LogFile
if ([string]::IsNullOrWhiteSpace($script:LogFile)) {
  try { $script:LogFile = Join-Path $env:TEMP 'dshdesk-window.log' } catch { $script:LogFile = '' }
}
$script:Polling = $false
$script:StaleSince = 0
$script:LastJson = ''
$script:Closed = $false
$script:Labels = @{}
$script:ColumnBodies = @{}
$script:ColumnFrames = @{}
$script:ColumnCounts = @{}
$script:ColumnNames = @{}
$script:CardTexts = @()
$script:SurfaceTexts = @()

function Write-Log {
  param([string]$Message)
  if ([string]::IsNullOrWhiteSpace($script:LogFile)) { return }
  try {
    $line = ('[{0}] {1}' -f (Get-Date -Format 'yyyy-MM-dd HH:mm:ss'), $Message)
    Add-Content -LiteralPath $script:LogFile -Value $line -Encoding UTF8
  } catch {}
}

function ConvertTo-Brush {
  param([object]$Value, [string]$Fallback)
  $text = [string]$Value
  if ($text -notmatch '^#[0-9a-fA-F]{6}([0-9a-fA-F]{2})?$') { $text = $Fallback }
  try {
    return (New-Object System.Windows.Media.BrushConverter).ConvertFromString($text)
  } catch {
    return (New-Object System.Windows.Media.BrushConverter).ConvertFromString($Fallback)
  }
}

function Get-Prop {
  param([object]$Object, [string]$Name, [object]$Default = $null)
  if ($null -eq $Object) { return $Default }
  try {
    $property = $Object.PSObject.Properties[$Name]
    if ($null -ne $property) { return $property.Value }
  } catch {}
  return $Default
}

function New-Text {
  param(
    [string]$Text = '',
    [double]$Size = 12,
    [string]$Color = '#545557',
    [string]$Weight = 'Normal',
    [string]$Trim = 'None',
    [string]$Wrap = 'NoWrap'
  )
  $block = New-Object System.Windows.Controls.TextBlock
  $block.Text = $Text
  $block.FontSize = $Size
  $block.Foreground = ConvertTo-Brush $Color '#545557'
  try { $block.FontWeight = [System.Windows.FontWeight]::$Weight } catch { $block.FontWeight = 'Normal' }
  try { $block.TextTrimming = [System.Windows.TextTrimming]::$Trim } catch {}
  try { $block.TextWrapping = [System.Windows.TextWrapping]::$Wrap } catch {}
  return $block
}

function New-Row {
  param([double]$Height = 0)
  $row = New-Object System.Windows.Controls.RowDefinition
  if ($Height -gt 0) { $row.Height = New-Object System.Windows.GridLength($Height) }
  else { $row.Height = New-Object System.Windows.GridLength(1, [System.Windows.GridUnitType]::Star) }
  return $row
}

function Test-Interactive {
  param([object]$Source)
  $node = $Source
  $guard = 0
  while ($null -ne $node -and $guard -lt 40) {
    $guard += 1
    if ($node -is [System.Windows.Controls.Primitives.ButtonBase]) { return $true }
    if ($node -is [System.Windows.Controls.Slider]) { return $true }
    if ($node -is [System.Windows.Controls.Primitives.Thumb]) { return $true }
    if ($node -eq $script:Window) { break }
    try {
      $node = [System.Windows.Media.VisualTreeHelper]::GetParent($node)
    } catch {
      break
    }
  }
  return $false
}

function Set-Banner {
  param([string]$Text, [bool]$Visible)
  $script:BannerText.Text = $Text
  if ($Visible) {
    $script:Banner.Visibility = [System.Windows.Visibility]::Visible
    $script:BannerRow.Height = New-Object System.Windows.GridLength(28)
  } else {
    $script:Banner.Visibility = [System.Windows.Visibility]::Collapsed
    $script:BannerRow.Height = New-Object System.Windows.GridLength(0)
  }
}

function Update-Theme {
  param([object]$Theme)
  $palette = @{
    bg = '#ffffff'
    layer1 = '#ffffff'
    layer2 = '#f5f6f7'
    sidebar = '#f9fafb'
    labelPrimary = '#0f1115'
    labelSecondary = '#545557'
    labelTertiary = '#81858c'
    border = '#1a000000'
    accent = '#4176e6'
    amber = '#f59e0b'
    green = '#22c55e'
    idle = '#d4d4d4'
    red = '#ec1313'
    dark = $false
  }
  if ($null -ne $Theme) {
    foreach ($key in @($palette.Keys)) {
      $value = Get-Prop $Theme $key $null
      if ($null -ne $value) { $palette[$key] = [string]$value }
    }
  }
  $script:Theme = $palette
  try {
    $script:Root.Background = ConvertTo-Brush $palette.bg '#ffffff'
    $script:Root.BorderBrush = ConvertTo-Brush $palette.border '#1a000000'
    $script:Header.Background = ConvertTo-Brush $palette.layer2 '#f5f6f7'
    $script:HeaderTitle.Foreground = ConvertTo-Brush $palette.labelPrimary '#0f1115'
    $script:HeaderSubtitle.Foreground = ConvertTo-Brush $palette.labelTertiary '#81858c'
    $script:OpacityLabel.Foreground = ConvertTo-Brush $palette.labelTertiary '#81858c'
    $script:FooterText.Foreground = ConvertTo-Brush $palette.labelTertiary '#81858c'
    $script:Banner.Background = ConvertTo-Brush $palette.layer2 '#f5f6f7'
    $script:BannerText.Foreground = ConvertTo-Brush $palette.red '#ec1313'
    foreach ($key in @($script:ColumnFrames.Keys)) {
      $frame = $script:ColumnFrames[$key]
      $frame.Background = ConvertTo-Brush $palette.sidebar '#f9fafb'
      $frame.BorderBrush = ConvertTo-Brush $palette.border '#1a000000'
    }
    foreach ($name in @($script:ColumnNames.Keys)) {
      $script:ColumnNames[$name].Foreground = ConvertTo-Brush $palette.labelSecondary '#545557'
    }
    foreach ($count in @($script:ColumnCounts.Values)) {
      $count.Foreground = ConvertTo-Brush $palette.labelTertiary '#81858c'
    }
    foreach ($text in @($script:SurfaceTexts)) {
      $text.Foreground = ConvertTo-Brush $palette.labelTertiary '#81858c'
    }
  } catch {
    Write-Log ('theme update failed: ' + $_.Exception.Message)
  }
}

function Add-Card {
  param([object]$ColumnPanel, [object]$Card)
  $theme = $script:Theme
  $cardBorder = New-Object System.Windows.Controls.Border
  $cardBorder.Margin = New-Object System.Windows.Thickness(0, 0, 0, 6)
  $cardBorder.Padding = New-Object System.Windows.Thickness(8)
  $cardBorder.CornerRadius = New-Object System.Windows.CornerRadius(9)
  $cardBorder.Background = ConvertTo-Brush $theme.layer1 '#ffffff'
  $cardBorder.BorderThickness = New-Object System.Windows.Thickness(1)
  $cardBorder.BorderBrush = ConvertTo-Brush $theme.border '#1a000000'
  if ([bool](Get-Prop $Card 'current' $false)) {
    $cardBorder.BorderBrush = ConvertTo-Brush $theme.accent '#4176e6'
    $cardBorder.BorderThickness = New-Object System.Windows.Thickness(1, 1, 1, 1)
  }
  $stack = New-Object System.Windows.Controls.StackPanel
  $title = New-Text ([string](Get-Prop $Card 'title' '未命名会话')) 13 $theme.labelPrimary 'Medium' 'CharacterEllipsis' 'Wrap'
  $title.MaxHeight = 54
  $title.LineHeight = 18
  $title.Margin = New-Object System.Windows.Thickness(0, 0, 0, 4)
  [void]$stack.Children.Add($title)

  $meta = New-Object System.Windows.Controls.Grid
  $meta.Margin = New-Object System.Windows.Thickness(0, 0, 0, 5)
  [void]$meta.ColumnDefinitions.Add((New-Object System.Windows.Controls.ColumnDefinition -Property @{ Width = New-Object System.Windows.GridLength(1, [System.Windows.GridUnitType]::Star) }))
  [void]$meta.ColumnDefinitions.Add((New-Object System.Windows.Controls.ColumnDefinition -Property @{ Width = [System.Windows.GridLength]::Auto }))
  $project = New-Text ([string](Get-Prop $Card 'project' '—')) 10 $theme.labelTertiary 'Normal' 'CharacterEllipsis' 'NoWrap'
  [System.Windows.Controls.Grid]::SetColumn($project, 0)
  $time = New-Text ([string](Get-Prop $Card 'relative' '')) 10 $theme.labelTertiary 'Normal' 'None' 'NoWrap'
  $time.Margin = New-Object System.Windows.Thickness(6, 0, 0, 0)
  [System.Windows.Controls.Grid]::SetColumn($time, 1)
  [void]$meta.Children.Add($project)
  [void]$meta.Children.Add($time)
  [void]$stack.Children.Add($meta)

  $footer = New-Object System.Windows.Controls.StackPanel
  $footer.Orientation = [System.Windows.Controls.Orientation]::Horizontal
  if ([bool](Get-Prop $Card 'current' $false)) {
    $current = New-Object System.Windows.Controls.Border
    $current.CornerRadius = New-Object System.Windows.CornerRadius(8)
    $current.Padding = New-Object System.Windows.Thickness(5, 0, 5, 0)
    $current.Background = ConvertTo-Brush $theme.layer2 '#f5f6f7'
    $currentText = New-Text ([string](Get-Prop $script:Labels 'current' '当前')) 9 $theme.accent 'Normal'
    $current.Child = $currentText
    $current.Margin = New-Object System.Windows.Thickness(0, 0, 5, 0)
    [void]$footer.Children.Add($current)
  }
  $badge = New-Object System.Windows.Controls.Border
  $badge.CornerRadius = New-Object System.Windows.CornerRadius(8)
  $badge.Padding = New-Object System.Windows.Thickness(6, 0, 6, 0)
  $badge.Background = ConvertTo-Brush $theme.layer2 '#f5f6f7'
  $badgeText = New-Text ([string](Get-Prop $Card 'badge' '')) 9 $theme.labelSecondary 'Normal'
  $badge.Child = $badgeText
  [void]$footer.Children.Add($badge)
  [void]$stack.Children.Add($footer)

  $cardBorder.Child = $stack
  $sessionId = [string](Get-Prop $Card 'id' '')
  $cardBorder.Tag = $sessionId
  $cardBorder.Cursor = [System.Windows.Input.Cursors]::Hand
  $cardBorder.ToolTip = '打开会话'
  $cardBorder.Add_MouseLeftButtonUp({
    param($sender, $event)
    $sid = [string]$sender.Tag
    if (-not [string]::IsNullOrWhiteSpace($sid)) {
      Post-Mirror ('open?session=' + [uri]::EscapeDataString($sid))
      $event.Handled = $true
    }
  })
  [void]$ColumnPanel.Children.Add($cardBorder)
}

function Update-Board {
  param([object]$Snapshot)
  if ($null -eq $Snapshot) { return }
  $json = $Snapshot | ConvertTo-Json -Depth 8 -Compress
  $labels = Get-Prop $Snapshot 'labels' $null
  if ($null -ne $labels) { $script:Labels = $labels }
  Update-Theme (Get-Prop $Snapshot 'theme' $null)
  if ($json -eq $script:LastJson) { return }
  $script:LastJson = $json
  $columns = Get-Prop $Snapshot 'columns' $null
  foreach ($key in @('needs', 'running', 'review', 'done')) {
    if (-not $script:ColumnBodies.ContainsKey($key)) { continue }
    $panel = $script:ColumnBodies[$key]
    $panel.Children.Clear()
    $cards = Get-Prop $columns $key @()
    $label = [string](Get-Prop $labels $key $key)
    $script:ColumnNames[$key].Text = $label
    $script:ColumnCounts[$key].Text = [string]@($cards).Count
    if ($null -eq $cards -or @($cards).Count -eq 0) {
      $empty = New-Text ([string](Get-Prop $labels 'empty' '暂无')) 11 $script:Theme.labelTertiary 'Normal' 'None' 'NoWrap'
      $empty.HorizontalAlignment = [System.Windows.HorizontalAlignment]::Center
      $empty.Margin = New-Object System.Windows.Thickness(0, 18, 0, 0)
      [void]$panel.Children.Add($empty)
    } else {
      foreach ($card in @($cards)) { Add-Card $panel $card }
    }
  }
}

function Invoke-Mirror {
  if ($script:Polling -or $script:Closed -or $Port -le 0) { return }
  $script:Polling = $true
  try {
    $uri = ('http://127.0.0.1:{0}/board?token={1}' -f $Port, $Token)
    $data = Invoke-RestMethod -Uri $uri -Method Get -TimeoutSec 2
    if ([bool](Get-Prop $data 'closeRequested' $false)) {
      $script:Window.Close()
      return
    }
    $stale = [bool](Get-Prop $data 'stale' $true)
    if ($stale) {
      if ($script:StaleSince -eq 0) { $script:StaleSince = [DateTime]::UtcNow }
      $labels = Get-Prop $data 'snapshot' $null
      $labels = if ($null -ne $labels) { Get-Prop $labels 'labels' $null } else { $null }
      $message = [string](Get-Prop $labels 'stale' '主窗 6 秒未同步，正在关闭…')
      Set-Banner $message $true
      if (([DateTime]::UtcNow - $script:StaleSince).TotalMilliseconds -gt 1100) {
        Write-Log 'mirror stale for more than 6 seconds; closing'
        $script:Window.Close()
      }
      return
    }
    $script:StaleSince = 0
    Set-Banner '' $false
    $snapshot = Get-Prop $data 'snapshot' $null
    if ($null -eq $snapshot) {
      Set-Banner ([string](Get-Prop $labels 'waiting' '等待主窗同步…')) $true
      return
    }
    Update-Board $snapshot
  } catch {
    if ($script:StaleSince -eq 0) { $script:StaleSince = [DateTime]::UtcNow }
    Set-Banner '主窗 6 秒未同步，正在关闭…' $true
    if (([DateTime]::UtcNow - $script:StaleSince).TotalMilliseconds -gt 6500) {
      Write-Log ('mirror unreachable; closing: ' + $_.Exception.Message)
      $script:Window.Close()
    }
  } finally {
    $script:Polling = $false
  }
}

function Post-Mirror {
  param([string]$Path)
  if ($Port -le 0) { return }
  try {
    $separator = if ($Path.Contains('?')) { '&' } else { '?' }
    $uri = ('http://127.0.0.1:{0}/{1}{2}token={3}' -f $Port, $Path, $separator, $Token)
    Invoke-RestMethod -Uri $uri -Method Post -TimeoutSec 2 | Out-Null
  } catch {}
}

function Build-Ui {
  $script:Window = New-Object System.Windows.Window
  $script:Window.Title = 'dshdesk'
  $script:Window.Width = 900
  $script:Window.Height = 620
  $script:Window.MinWidth = 760
  $script:Window.MinHeight = 210
  $script:Window.WindowStyle = [System.Windows.WindowStyle]::None
  $script:Window.AllowsTransparency = $true
  $script:Window.Background = [System.Windows.Media.Brushes]::Transparent
  $script:Window.Topmost = $true
  $script:Window.ResizeMode = [System.Windows.ResizeMode]::CanResize
  $script:Window.WindowStartupLocation = [System.Windows.WindowStartupLocation]::CenterScreen
  $script:Window.ShowInTaskbar = $true
  $script:Window.FontFamily = New-Object System.Windows.Media.FontFamily('Microsoft YaHei UI, Segoe UI')
  $script:Window.Opacity = [Math]::Max(0.3, [Math]::Min(1.0, $Opacity))

  try {
    $chrome = New-Object System.Windows.Shell.WindowChrome
    $chrome.CaptionHeight = 0
    $chrome.ResizeBorderThickness = New-Object System.Windows.Thickness(6)
    $chrome.GlassFrameThickness = New-Object System.Windows.Thickness(0)
    $chrome.UseAeroCaptionButtons = $false
    [System.Windows.Shell.WindowChrome]::SetWindowChrome($script:Window, $chrome)
  } catch {
    Write-Log ('window chrome unavailable: ' + $_.Exception.Message)
  }

  $script:Root = New-Object System.Windows.Controls.Border
  $script:Root.Margin = New-Object System.Windows.Thickness(8)
  $script:Root.CornerRadius = New-Object System.Windows.CornerRadius(14)
  $script:Root.BorderThickness = New-Object System.Windows.Thickness(1)
  $script:Root.Background = ConvertTo-Brush '#ffffff' '#ffffff'
  $script:Root.BorderBrush = ConvertTo-Brush '#1a000000' '#1a000000'
  $shadow = New-Object System.Windows.Media.Effects.DropShadowEffect
  $shadow.BlurRadius = 20
  $shadow.ShadowDepth = 4
  $shadow.Opacity = 0.35
  $shadow.Color = [System.Windows.Media.Color]::FromArgb(255, 0, 0, 0)
  $script:Root.Effect = $shadow
  $script:Window.Content = $script:Root

  $grid = New-Object System.Windows.Controls.Grid
  [void]$grid.RowDefinitions.Add((New-Row 46))
  $script:BannerRow = New-Row 0
  [void]$grid.RowDefinitions.Add($script:BannerRow)
  [void]$grid.RowDefinitions.Add((New-Row 0))
  [void]$grid.RowDefinitions.Add((New-Row 26))
  $script:Root.Child = $grid

  $script:Header = New-Object System.Windows.Controls.Border
  $script:Header.Padding = New-Object System.Windows.Thickness(13, 7, 10, 7)
  $script:Header.Background = ConvertTo-Brush '#f5f6f7' '#f5f6f7'
  $script:Header.CornerRadius = New-Object System.Windows.CornerRadius(14, 14, 0, 0)
  [System.Windows.Controls.Grid]::SetRow($script:Header, 0)
  [void]$grid.Children.Add($script:Header)

  $headerGrid = New-Object System.Windows.Controls.Grid
  [void]$headerGrid.ColumnDefinitions.Add((New-Object System.Windows.Controls.ColumnDefinition -Property @{ Width = New-Object System.Windows.GridLength(1, [System.Windows.GridUnitType]::Star) }))
  [void]$headerGrid.ColumnDefinitions.Add((New-Object System.Windows.Controls.ColumnDefinition -Property @{ Width = [System.Windows.GridLength]::Auto }))
  [void]$headerGrid.ColumnDefinitions.Add((New-Object System.Windows.Controls.ColumnDefinition -Property @{ Width = [System.Windows.GridLength]::Auto }))
  [void]$headerGrid.ColumnDefinitions.Add((New-Object System.Windows.Controls.ColumnDefinition -Property @{ Width = [System.Windows.GridLength]::Auto }))
  [void]$headerGrid.ColumnDefinitions.Add((New-Object System.Windows.Controls.ColumnDefinition -Property @{ Width = [System.Windows.GridLength]::Auto }))
  $script:Header.Child = $headerGrid

  $heading = New-Object System.Windows.Controls.StackPanel
  $script:HeaderTitle = New-Text 'dshdesk' 14 '#0f1115' 'SemiBold'
  $script:HeaderSubtitle = New-Text '现在有没有事需要我' 10 '#81858c'
  [void]$heading.Children.Add($script:HeaderTitle)
  [void]$heading.Children.Add($script:HeaderSubtitle)
  [System.Windows.Controls.Grid]::SetColumn($heading, 0)
  [void]$headerGrid.Children.Add($heading)

  $live = New-Object System.Windows.Controls.StackPanel
  $live.Orientation = [System.Windows.Controls.Orientation]::Horizontal
  $live.VerticalAlignment = [System.Windows.VerticalAlignment]::Center
  $dot = New-Object System.Windows.Shapes.Ellipse
  $dot.Width = 6
  $dot.Height = 6
  $dot.Fill = ConvertTo-Brush '#22c55e' '#22c55e'
  $dot.Margin = New-Object System.Windows.Thickness(0, 0, 4, 0)
  $liveText = New-Text '实时' 10 '#81858c'
  [void]$live.Children.Add($dot)
  [void]$live.Children.Add($liveText)
  [System.Windows.Controls.Grid]::SetColumn($live, 1)
  [void]$headerGrid.Children.Add($live)

  $opacityPanel = New-Object System.Windows.Controls.StackPanel
  $opacityPanel.Orientation = [System.Windows.Controls.Orientation]::Horizontal
  $opacityPanel.VerticalAlignment = [System.Windows.VerticalAlignment]::Center
  $opacityPanel.Margin = New-Object System.Windows.Thickness(12, 0, 8, 0)
  $script:OpacityLabel = New-Text ('{0}%' -f [int]([Math]::Round($script:Window.Opacity * 100))) 10 '#81858c'
  $script:OpacityLabel.Width = 30
  $script:OpacitySlider = New-Object System.Windows.Controls.Slider
  $script:OpacitySlider.Minimum = 30
  $script:OpacitySlider.Maximum = 100
  $script:OpacitySlider.Value = [int]([Math]::Round($script:Window.Opacity * 100))
  $script:OpacitySlider.Width = 74
  $script:OpacitySlider.IsMoveToPointEnabled = $true
  [void]$opacityPanel.Children.Add($script:OpacitySlider)
  [void]$opacityPanel.Children.Add($script:OpacityLabel)
  [System.Windows.Controls.Grid]::SetColumn($opacityPanel, 2)
  [void]$headerGrid.Children.Add($opacityPanel)

  $script:PinButton = New-Object System.Windows.Controls.Primitives.ToggleButton
  $script:PinButton.Width = 26
  $script:PinButton.Height = 26
  $script:PinButton.IsChecked = $true
  $script:PinButton.Content = '📌'
  $script:PinButton.FontSize = 12
  $script:PinButton.ToolTip = '窗口置顶 / 取消置顶'
  $script:PinButton.Margin = New-Object System.Windows.Thickness(0, 0, 4, 0)
  $script:PinButton.Background = [System.Windows.Media.Brushes]::Transparent
  $script:PinButton.BorderThickness = New-Object System.Windows.Thickness(0)
  $script:PinButton.Foreground = ConvertTo-Brush '#545557' '#545557'
  [System.Windows.Controls.Grid]::SetColumn($script:PinButton, 3)
  [void]$headerGrid.Children.Add($script:PinButton)

  $script:CloseButton = New-Object System.Windows.Controls.Button
  $script:CloseButton.Width = 26
  $script:CloseButton.Height = 26
  $script:CloseButton.Content = '×'
  $script:CloseButton.ToolTip = '关闭'
  $script:CloseButton.Background = [System.Windows.Media.Brushes]::Transparent
  $script:CloseButton.BorderThickness = New-Object System.Windows.Thickness(0)
  $script:CloseButton.Foreground = ConvertTo-Brush '#545557' '#545557'
  $script:CloseButton.FontSize = 16
  [System.Windows.Controls.Grid]::SetColumn($script:CloseButton, 4)
  [void]$headerGrid.Children.Add($script:CloseButton)

  $script:Banner = New-Object System.Windows.Controls.Border
  $script:Banner.Visibility = [System.Windows.Visibility]::Collapsed
  $script:Banner.Background = ConvertTo-Brush '#f5f6f7' '#f5f6f7'
  $script:Banner.Padding = New-Object System.Windows.Thickness(13, 4, 13, 4)
  $script:BannerText = New-Text '' 10 '#ec1313'
  $script:Banner.Child = $script:BannerText
  [System.Windows.Controls.Grid]::SetRow($script:Banner, 1)
  [void]$grid.Children.Add($script:Banner)

  $body = New-Object System.Windows.Controls.Border
  $body.Background = ConvertTo-Brush '#ffffff' '#ffffff'
  $body.Padding = New-Object System.Windows.Thickness(10)
  [System.Windows.Controls.Grid]::SetRow($body, 2)
  [void]$grid.Children.Add($body)
  $uniform = New-Object System.Windows.Controls.Primitives.UniformGrid
  $uniform.Columns = 4
  $body.Child = $uniform

  foreach ($key in @('needs', 'running', 'review', 'done')) {
    $column = New-Object System.Windows.Controls.Border
    $column.Margin = New-Object System.Windows.Thickness(4)
    $column.CornerRadius = New-Object System.Windows.CornerRadius(10)
    $column.BorderThickness = New-Object System.Windows.Thickness(1)
    $column.BorderBrush = ConvertTo-Brush '#1a000000' '#1a000000'
    $column.Background = ConvertTo-Brush '#f9fafb' '#f9fafb'
    $colGrid = New-Object System.Windows.Controls.Grid
    [void]$colGrid.RowDefinitions.Add((New-Row 30))
    [void]$colGrid.RowDefinitions.Add((New-Row 0))
    $column.Child = $colGrid

    $colHeader = New-Object System.Windows.Controls.StackPanel
    $colHeader.Orientation = [System.Windows.Controls.Orientation]::Horizontal
    $colHeader.Margin = New-Object System.Windows.Thickness(8, 6, 8, 3)
    $colDot = New-Object System.Windows.Shapes.Ellipse
    $colDot.Width = 6
    $colDot.Height = 6
    $colDot.Margin = New-Object System.Windows.Thickness(0, 0, 5, 0)
    $dotColor = if ($key -eq 'needs') { '#f59e0b' } elseif ($key -eq 'running') { '#4176e6' } elseif ($key -eq 'review') { '#22c55e' } else { '#d4d4d4' }
    $colDot.Fill = ConvertTo-Brush $dotColor $dotColor
    $colName = New-Text $key 11 '#545557' 'Medium'
    $colName.VerticalAlignment = [System.Windows.VerticalAlignment]::Center
    $colCount = New-Text '0' 9 '#81858c'
    $colCount.VerticalAlignment = [System.Windows.VerticalAlignment]::Center
    $colCount.Margin = New-Object System.Windows.Thickness(5, 0, 0, 0)
    [void]$colHeader.Children.Add($colDot)
    [void]$colHeader.Children.Add($colName)
    [void]$colHeader.Children.Add($colCount)
    [System.Windows.Controls.Grid]::SetRow($colHeader, 0)
    [void]$colGrid.Children.Add($colHeader)

    $scroll = New-Object System.Windows.Controls.ScrollViewer
    $scroll.VerticalScrollBarVisibility = [System.Windows.Controls.ScrollBarVisibility]::Auto
    $scroll.HorizontalScrollBarVisibility = [System.Windows.Controls.ScrollBarVisibility]::Disabled
    $scroll.Padding = New-Object System.Windows.Thickness(6, 0, 6, 6)
    $panel = New-Object System.Windows.Controls.StackPanel
    $scroll.Content = $panel
    [System.Windows.Controls.Grid]::SetRow($scroll, 1)
    [void]$colGrid.Children.Add($scroll)

    $script:ColumnBodies[$key] = $panel
    $script:ColumnFrames[$key] = $column
    $script:ColumnCounts[$key] = $colCount
    $script:ColumnNames[$key] = $colName
    [void]$uniform.Children.Add($column)
  }

  $footer = New-Object System.Windows.Controls.Border
  $footer.Padding = New-Object System.Windows.Thickness(13, 2, 13, 4)
  [System.Windows.Controls.Grid]::SetRow($footer, 3)
  [void]$grid.Children.Add($footer)
  $script:FooterText = New-Text '只读 · 800ms 镜像 · 6s 未同步自动关闭' 9 '#81858c'
  $footer.Child = $script:FooterText

  $script:Window.Add_KeyDown({
    param($sender, $event)
    if ($event.Key -eq [System.Windows.Input.Key]::Escape) {
      $sender.Close()
    }
  })
  $script:Window.Add_Closed({
    $script:Closed = $true
    if ($null -ne $script:PollTimer) { $script:PollTimer.Stop() }
    Post-Mirror 'closed'
    Write-Log 'window closed'
  })
  $script:Window.Add_Activated({
    if ($Port -gt 0) { try { Invoke-RestMethod -Uri ('http://127.0.0.1:{0}/focus?token={1}&focused=1' -f $Port, $Token) -Method Post -TimeoutSec 1 | Out-Null } catch {} }
  })
  $script:Window.Add_Deactivated({
    if ($Port -gt 0) { try { Invoke-RestMethod -Uri ('http://127.0.0.1:{0}/focus?token={1}&focused=0' -f $Port, $Token) -Method Post -TimeoutSec 1 | Out-Null } catch {} }
  })

  $script:CloseButton.Add_Click({ $script:Window.Close() })
  $script:PinButton.Add_Checked({
    $script:Window.Topmost = $true
    Write-Log 'always-on-top on'
  })
  $script:PinButton.Add_Unchecked({
    $script:Window.Topmost = $false
    Write-Log 'always-on-top off'
  })

  $script:OpacityDebounce = New-Object System.Windows.Threading.DispatcherTimer
  $script:OpacityDebounce.Interval = [TimeSpan]::FromMilliseconds(350)
  $script:OpacityDebounce.Add_Tick({
    $script:OpacityDebounce.Stop()
    $value = [int]([Math]::Round($script:OpacitySlider.Value))
    if ($Port -gt 0) {
      try { Invoke-RestMethod -Uri ('http://127.0.0.1:{0}/opacity?token={1}&value={2}' -f $Port, $Token, $value) -Method Post -TimeoutSec 1 | Out-Null } catch {}
    }
  })
  $script:OpacitySlider.Add_ValueChanged({
    $pct = [int]([Math]::Round($script:OpacitySlider.Value))
    $script:Window.Opacity = $pct / 100.0
    $script:OpacityLabel.Text = ('{0}%' -f $pct)
    $script:OpacityDebounce.Stop()
    $script:OpacityDebounce.Start()
  })

  $script:Header.Add_MouseLeftButtonDown({
    param($sender, $event)
    if (Test-Interactive $event.OriginalSource) { return }
    try { $script:Window.DragMove() } catch {}
  })

  Update-Theme $null
  Set-Banner '' $false
}

try {
  Add-Type -AssemblyName PresentationFramework
  Add-Type -AssemblyName PresentationCore
  Add-Type -AssemblyName WindowsBase
  [System.Net.ServicePointManager]::SecurityProtocol = [System.Net.SecurityProtocolType]::Tls12
  [System.Net.WebRequest]::DefaultWebProxy = $null
  Write-Log 'starting dshdesk companion'
  Build-Ui

  if ($SelfTest) {
    $sample = [pscustomobject]@{
      generatedAt = [DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds()
      locale = 'zh'
      currentSessionId = 'self'
      theme = [pscustomobject]@{ dark = $true; bg = '#1b1b1c'; layer1 = '#232324'; layer2 = '#2c2c2e'; sidebar = '#151517'; labelPrimary = '#f5f5f5'; labelSecondary = '#cfd3d6'; labelTertiary = '#979da6'; border = '#ffffff1f'; accent = '#7aaaff'; amber = '#f59e0b'; green = '#22c55e'; idle = '#545557'; red = '#f25a5a' }
      labels = [pscustomobject]@{ needs = '需要你'; running = '进行中'; review = '验收'; done = '完成'; empty = '暂无'; current = '当前'; stale = '断线'; waiting = '等待' }
      columns = [pscustomobject]@{
        needs = @([pscustomobject]@{ id = 'self'; title = '自检卡片'; project = 'dshdesk'; relative = '刚刚'; badge = '待审批'; current = $true })
        running = @(); review = @(); done = @()
      }
      counts = [pscustomobject]@{ needs = 1; running = 0; review = 0; done = 0; total = 1 }
    }
    Update-Board $sample
    $bgColor = if ($null -ne $script:Root.Background -and $script:Root.Background -is [System.Windows.Media.SolidColorBrush]) { $script:Root.Background.Color.ToString() } else { 'not-solid' }
    $headerColor = if ($null -ne $script:Header.Background -and $script:Header.Background -is [System.Windows.Media.SolidColorBrush]) { $script:Header.Background.Color.ToString() } else { 'not-solid' }
    Write-Output ('SELFTEST_OK width={0} height={1} min={2}x{3} top={4} opacity={5} bg={6} header={7}' -f $script:Window.Width, $script:Window.Height, $script:Window.MinWidth, $script:Window.MinHeight, $script:Window.Topmost, $script:Window.Opacity, $bgColor, $headerColor)
  } else {
    $script:PollTimer = New-Object System.Windows.Threading.DispatcherTimer
    $script:PollTimer.Interval = [TimeSpan]::FromMilliseconds(800)
    $script:PollTimer.Add_Tick({ Invoke-Mirror })
    $script:PollTimer.Start()
    Invoke-Mirror
    [void]$script:Window.ShowDialog()
  }
  Write-Log 'companion exited cleanly'
  exit 0
} catch {
  $message = $_.Exception.Message
  Write-Log ('fatal: ' + $message)
  if ($SelfTest) {
    Write-Output ('SELFTEST_FAIL ' + $message)
    exit 1
  }
  try {
    [System.Windows.MessageBox]::Show(('dshdesk companion failed: ' + $message), 'dshdesk') | Out-Null
  } catch {}
  exit 1
}
