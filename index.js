import React from 'react';
import PropTypes from 'prop-types';
import {
  View,
  StyleSheet,
  PanResponder,
  Animated,
  TouchableWithoutFeedback,
  Dimensions,
  Easing,
  BackHandler,
  Platform,
  Modal,
  Keyboard
} from 'react-native';
import { isIphoneX, getStatusBarHeight, getBottomSpace } from 'react-native-iphone-x-helper'

const {height: SCREEN_HEIGHT, width: SCREEN_WIDTH} = Dimensions.get('window');
const styles = StyleSheet.create({
  wrapper: {
    backgroundColor: 'white'
  },
  transparent: {
    zIndex: 2,
    backgroundColor: 'rgba(0,0,0,0)'
  },
  absolute: {
    position: 'absolute',
    top: 0,
    bottom: 0,
    left: 0,
    right: 0
  }
});

const MODAL_SIZE_FULLSCREEN = "MODAL_SIZE_FULLSCREEN";
const MODAL_SIZE_AUTO = "MODAL_SIZE_AUTO";

const ANIMATION_MODAL_DEFAULT = "DEFAULT";
const ANIMATION_MODAL_FADE = "FADE";

export default class ModalBox extends React.PureComponent {
  static propTypes = {
    isOpen: PropTypes.bool,
    isDisabled: PropTypes.bool,
    startOpen: PropTypes.bool,
    backdropPressToClose: PropTypes.bool,
    swipeToClose: PropTypes.bool,
    swipeThreshold: PropTypes.number,
    swipeArea: PropTypes.number,
    position: PropTypes.string,
    entry: PropTypes.string,
    backdrop: PropTypes.bool,
    backdropOpacity: PropTypes.number,
    backdropColor: PropTypes.string,
    backdropContent: PropTypes.element,
    animationDuration: PropTypes.number,
    backButtonClose: PropTypes.bool,
    easing: PropTypes.func,
    coverScreen: PropTypes.bool,
    keyboardTopOffset: PropTypes.number,
    onClosed: PropTypes.func,
    onOpened: PropTypes.func,
    onClosingState: PropTypes.func,
    modalOpacity: PropTypes.number,
    modalAnimationType : PropTypes.string,
    initialModalSize: PropTypes.string,
  };

  static defaultProps = {
    startOpen: false,
    backdropPressToClose: true,
    swipeToClose: true,
    swipeThreshold: 50,
    position: 'center',
    backdrop: true,
    backdropOpacity: 0.5,
    backdropColor: 'black',
    backdropContent: null,
    animationDuration: 400,
    backButtonClose: false,
    easing: Easing.elastic(0.8),
    coverScreen: false,
    keyboardTopOffset: Platform.OS == 'ios' ? 0 : 0,
    useNativeDriver: true,
    modalOpacity: 0, 
    modalAnimationType: ANIMATION_MODAL_DEFAULT,
    initialModalSize: MODAL_SIZE_AUTO
  };

  constructor(props) {
    super(props);

    this.onBackPress = this.onBackPress.bind(this);
    this.handleOpenning = this.handleOpenning.bind(this);
    this.onKeyboardHide = this.onKeyboardHide.bind(this);
    this.onKeyboardChange = this.onKeyboardChange.bind(this);
    this.animateBackdropOpen = this.animateBackdropOpen.bind(this);
    this.animateBackdropClose = this.animateBackdropClose.bind(this);
    this.stopAnimateOpen = this.stopAnimateOpen.bind(this);
    this.animateOpen = this.animateOpen.bind(this);
    this.stopAnimateClose = this.stopAnimateClose.bind(this);
    this.animateClose = this.animateClose.bind(this);
    this.calculateModalPosition = ModalBox.calculateModalPosition;
    this.createPanResponder = this.createPanResponder.bind(this);
    this.onViewLayout = this.onViewLayout.bind(this);
    this.onContainerLayout = this.onContainerLayout.bind(this);
    this.renderBackdrop = this.renderBackdrop.bind(this);
    this.renderContent = this.renderContent.bind(this);
    this.open = this.open.bind(this);
    this.close = this.close.bind(this);

    const screenHeight = SCREEN_HEIGHT - (getStatusBarHeight(true) + getBottomSpace())

    const position = props.startOpen
      ? new Animated.Value(0)
      : new Animated.Value(
          props.entry === 'top' ? -screenHeight : screenHeight
        );

    this.state = {
      position,
      backdropOpacity: new Animated.Value(0),
      modalOpacity: new Animated.Value(0),
      isOpen: props.startOpen,
      isAnimateClose: false,
      isAnimateOpen: false,
      swipeToClose: false,
      height: screenHeight,
      width: SCREEN_WIDTH,
      containerHeight: screenHeight,
      containerWidth: SCREEN_WIDTH,
      isInitialized: false,
      keyboardOffset: 0,
      pan: this.createPanResponder(position)
    };

    // Needed for iOS because the keyboard covers the screen
    if (Platform.OS === 'ios') {
      this.subscriptions = [
        Keyboard.addListener('keyboardWillChangeFrame', this.onKeyboardChange),
        Keyboard.addListener('keyboardDidHide', this.onKeyboardHide)
      ];
    }
  }

  static getLatestHeightStyles(props) {
    if (props && props.style) {
      var styleHeight = null

      if (props.style instanceof Array) {  
        for (let idx in props.style) {
          let objStyleAtIdx = props.style[idx]
          
          if (objStyleAtIdx instanceof Array) {
            styleHeight = ModalBox.getLatestHeightStyles({style : objStyleAtIdx})
          } else {
            styleHeight = objStyleAtIdx.height ? objStyleAtIdx.height : styleHeight
          }    
        }
      } else if (props.style.height) {
        styleHeight = props.style.height
      }

      return styleHeight
    }

    return null
  }

  static getDerivedStateFromProps(props, state) {
    let styleHeight = ModalBox.getLatestHeightStyles(props)

    if (styleHeight) {
      let positionDest = ModalBox.calculateModalPosition(
        state.containerHeight - state.keyboardOffset,
        state.containerWidth,
        props,
        state
      );

      if (Math.floor(styleHeight) != Math.floor(state.height)) {
        if (props.modalAnimationType == ANIMATION_MODAL_FADE || positionDest != state.positionDest) {
          return {
            ...state,
            positionDest
          }
        }
      }
    }
    
    return null
  }

  componentDidMount() {
    this.handleOpenning();
  }

  componentDidUpdate(prevProps) {
    if (this.props.isOpen != prevProps.isOpen) {
      this.handleOpenning();
    }
  }

  componentWillUnmount() {
    if (this.subscriptions) this.subscriptions.forEach(sub => sub.remove());
    if (this.props.backButtonClose && Platform.OS === 'android')
      BackHandler.removeEventListener('hardwareBackPress', this.onBackPress);
  }

  onBackPress() {
    this.close();
    return true;
  }

  handleOpenning() {
    if (typeof this.props.isOpen == 'undefined') return;
    if (this.props.isOpen) this.open();
    else this.close();
  }

  /****************** ANIMATIONS **********************/

  /*
   * The keyboard is hidden (IOS only)
   */
  onKeyboardHide(evt) {
    this.setState({keyboardOffset: 0});
  }

  /*
   * The keyboard frame changed, used to detect when the keyboard open, faster than keyboardDidShow (IOS only)
   */
  onKeyboardChange(evt) {
    if (!evt) return;
    if (!this.state.isOpen) return;
    const keyboardFrame = evt.endCoordinates;
    const keyboardHeight = keyboardFrame.screenY == SCREEN_HEIGHT || keyboardFrame.screenY > this.state.containerHeight
      ? 0
      : this.state.containerHeight - (keyboardFrame.screenY - getStatusBarHeight(true));

    this.setState({keyboardOffset: keyboardHeight}, () => {
      this.animateOpen();
    });
  }

  /*
   * Open animation for the backdrop, will fade in
   */
  animateBackdropOpen() {
    if (this.state.isAnimateBackdrop && this.state.animBackdrop) {
      this.state.animBackdrop.stop();
    }
    this.setState({isAnimateBackdrop: true});

    let animBackdrop = Animated.timing(this.state.backdropOpacity, {
      toValue: 1,
      duration: this.props.animationDuration,
      easing: this.props.easing,
      useNativeDriver: this.props.useNativeDriver
    }).start(() => {
      this.setState({
        isAnimateBackdrop: false,
        animBackdrop
      });
    });
  }

  /*
   * Close animation for the backdrop, will fade out
   */
  animateBackdropClose() {
    if (this.state.isAnimateBackdrop && this.state.animBackdrop) {
      this.state.animBackdrop.stop();
    }
    this.setState({isAnimateBackdrop: true});

    let animBackdrop = Animated.timing(this.state.backdropOpacity, {
      toValue: 0,
      duration: this.props.animationDuration,
      easing: this.props.easing,
      useNativeDriver: this.props.useNativeDriver
    }).start(() => {
      this.setState({
        isAnimateBackdrop: false,
        animBackdrop
      });
    });
  }

  /*
   * Stop opening animation
   */
stopAnimateOpen() {
  if (this.state.isAnimateOpen) {
    if (this.state.animOpen) this.state.animOpen.stop();
    this.setState({isAnimateOpen: false});
  }
}

getModalAnimate({isOpen, positionDest}) {
    var animate = null;

    switch(this.props.modalAnimationType) {
      case ANIMATION_MODAL_DEFAULT:
        if(isOpen){
          animate = Animated.timing(
              this.state.position,
              {
                toValue: positionDest,
                duration: this.props.animationDuration,
                easing: this.props.easing,
                useNativeDriver: this.props.useNativeDriver
              }
          );
        } else {
          animate = Animated.timing(
              this.state.position,
              {
                toValue: this.state.containerHeight,
                duration: this.props.animationDuration,
                useNativeDriver: this.props.useNativeDriver
              }
          );
        }
        break;
      case ANIMATION_MODAL_FADE:
        if(isOpen) {
          animate = Animated.timing(
              this.state.modalOpacity,
              {
                toValue: 1,
                duration: this.props.animationDuration,
                useNativeDriver: this.props.useNativeDriver
              }
          );
        } else {
          animate = Animated.timing(
              this.state.modalOpacity,
              {
                toValue: 0,
                duration: this.props.animationDuration,
                useNativeDriver: this.props.useNativeDriver
              }
          );
        }
        break;
    }

    return animate;
  }

  recalculateModalPosition() {
    this.setState({
        isAnimateOpen: true,
    }, () => {
        // Detecting modal position CUSTOM BY IRVINGDP
      let positionDest = ModalBox.calculateModalPosition(
        this.state.containerHeight - this.state.keyboardOffset,
        this.state.containerWidth,
        this.props,
        this.state
      );

      let animOpen = this.getModalAnimate({isOpen:true, positionDest}).start(() => {
        this.setState({
            isAnimateOpen: false,
            animOpen,
            positionDest
          });
      });
    });
  }
  
  /*
   * Open animation for the modal, will move up
   */
  animateOpen() {
    this.stopAnimateClose();

    // Backdrop fadeIn
    if (this.props.backdrop) this.animateBackdropOpen();

    this.setState(
      {
        isAnimateOpen: true,
        isOpen: true
      },
      () => {
        /* 
        requestAnimationFrame(() => {
          // Detecting modal position DEFAULT
          let positionDest = this.calculateModalPosition(
            this.state.containerHeight - this.state.keyboardOffset,
            this.state.containerWidth
          );
          if (
            this.state.keyboardOffset &&
            positionDest < this.props.keyboardTopOffset
          ) {
            positionDest = this.props.keyboardTopOffset;
          }
          let animOpen = Animated.timing(this.state.position, {
            toValue: positionDest,
            duration: this.props.animationDuration,
            easing: this.props.easing,
            useNativeDriver: this.props.useNativeDriver
          }).start(() => {
            this.setState({
              isAnimateOpen: false,
              animOpen,
              positionDest
            });
            if (this.props.onOpened) this.props.onOpened();
          });
        }); 
        */

        // Detecting modal position CUSTOM BY IRVINGDP
        let positionDest = ModalBox.calculateModalPosition(
          this.state.containerHeight - this.state.keyboardOffset,
          this.state.containerWidth,
          this.props,
          this.state
        );

        let animOpen = this.getModalAnimate({isOpen:true, positionDest}).start(() => {
          this.setState({
              isAnimateOpen: false,
              animOpen,
              positionDest
            });

          if (this.props.onOpened) this.props.onOpened()
        });
      }
    );
  }

  /*
   * Stop closing animation
   */
  stopAnimateClose() {
    if (this.state.isAnimateClose) {
      if (this.state.animClose) this.state.animClose.stop();
      this.setState({isAnimateClose: false});
    }
  }

  /*
   * Close animation for the modal, will move down
   */
  animateClose() {
    this.stopAnimateOpen();

    // Backdrop fadeout
    if (this.props.backdrop) this.animateBackdropClose();

    this.setState(
      {
        isAnimateClose: true,
        isOpen: false
      },
      () => {
        /*
        let animClose = Animated.timing(this.state.position, {
          toValue:
            this.props.entry === 'top'
              ? -this.state.containerHeight
              : this.state.containerHeight,
          duration: this.props.animationDuration,
          easing: this.props.easing,
          useNativeDriver: this.props.useNativeDriver
        }).start(() => {
        */
        let animClose = this.getModalAnimate({isOpen:false}).start(() => {
          // Keyboard.dismiss();   // make this optional. Easily user defined in .onClosed() callback
          this.setState({
            isAnimateClose: false,
            animClose
          }, () => {
            /* Set the state to the starting position of the modal, preventing from animating where the swipe stopped */
            this.state.position.setValue(this.props.entry === 'top' ? -this.state.containerHeight : this.state.containerHeight);
          });
          if (this.props.onClosed) this.props.onClosed();
        });
      }
    );
  }

  /*
   * Calculate when should be placed the modal
   */
  static calculateModalPosition(containerHeight, containerWidth, props, state) {
    let position = 0;
    
    let styleHeight = ModalBox.getLatestHeightStyles(props) 
      ? ModalBox.getLatestHeightStyles(props)
      : state.height 

    if (props.position == 'bottom') {
      position = containerHeight - styleHeight;
    } else if (props.position == 'center') {
      position = (containerHeight - styleHeight) / 2;
    }
    
    if (position < 0) position = 0;

    if (
      state.keyboardOffset &&
      position < props.keyboardTopOffset
    ) {
      position = props.keyboardTopOffset;
    }

    return position;
  }

  /*
   * Create the pan responder to detect gesture
   * Only used if swipeToClose is enabled
   */
  createPanResponder(position) {
    let closingState = false;
    let inSwipeArea = false;

    const onPanStart = (evt, state) => {
      if (
        !this.props.swipeToClose ||
        this.props.isDisabled ||
        (this.props.swipeArea &&
          evt.nativeEvent.pageY - this.state.positionDest >
            this.props.swipeArea)
      ) {
        inSwipeArea = false;
        return false;
      }
      inSwipeArea = true;
      return true;
    };

    const animEvt = Animated.event([null, {customY: position}], {useNativeDriver: false});

    const onPanMove = (evt, state) => {
      const newClosingState =
        this.props.entry === 'top'
          ? -state.dy > this.props.swipeThreshold
          : state.dy > this.props.swipeThreshold;
      if (this.props.entry === 'top' ? state.dy > 0 : state.dy < 0) return;
      if (newClosingState != closingState && this.props.onClosingState)
        this.props.onClosingState(newClosingState);
      closingState = newClosingState;
      state.customY = state.dy + this.state.positionDest;

      animEvt(evt, state);
    };

    const onPanRelease = (evt, state) => {
      if (!inSwipeArea) return;
      inSwipeArea = false;
      if (
        this.props.entry === 'top'
          ? -state.dy > this.props.swipeThreshold
          : state.dy > this.props.swipeThreshold
      ) {
        this.close();
      } else if (!this.state.isOpen) {
        this.animateOpen();
      }
    };

    return PanResponder.create({
      onStartShouldSetPanResponder: onPanStart,
      onPanResponderMove: onPanMove,
      onPanResponderRelease: onPanRelease,
      onPanResponderTerminate: onPanRelease
    });
  }

  /*
   * Event called when the modal view layout is calculated
   */
  onViewLayout(evt) {
    const height = evt.nativeEvent.layout.height;
    const width = evt.nativeEvent.layout.width;

    // If the dimensions are still the same we're done
    let newState = {};
    let isChangedHeight = height !== this.state.height
    if (height !== this.state.height) newState.height = height;
    if (width !== this.state.width) newState.width = width;

    this.setState(newState, () => {
      if(isChangedHeight) {          
          this.recalculateModalPosition();
        }
    });

    if (this.onViewLayoutCalculated) this.onViewLayoutCalculated();
  }

  /*
   * Event called when the container view layout is calculated
   */
  onContainerLayout(evt) {
    const height = evt.nativeEvent.layout.height;
    const width = evt.nativeEvent.layout.width;

    // If the container size is still the same we're done
    if (
      height == this.state.containerHeight &&
      width == this.state.containerWidth
    ) {
      this.setState({isInitialized: true});
      return;
    }

    if (this.state.isOpen || this.state.isAnimateOpen) {
      this.animateOpen();
    }

    if (this.props.onLayout) this.props.onLayout(evt);

    this.setState({
      isInitialized: true,
      containerHeight: height,
      containerWidth: width
    });
  }

  /*
   * Render the backdrop element
   */
  renderBackdrop() {
    let backdrop = null;

    if (this.props.backdrop) {
      backdrop = (
        <TouchableWithoutFeedback
          onPress={this.props.backdropPressToClose ? this.close : null}>
          <Animated.View
            importantForAccessibility="no"
            style={[styles.absolute, {opacity: this.state.backdropOpacity}]}>
            <View
              style={[
                styles.absolute,
                {
                  backgroundColor: this.props.backdropColor,
                  opacity: this.props.backdropOpacity
                }
              ]}
            />
            {this.props.backdropContent || []}
          </Animated.View>
        </TouchableWithoutFeedback>
      );
    }

    return backdrop;
  }

  renderContent() {
    const size = this.props.initalModalSize == MODAL_SIZE_FULLSCREEN ? {
      height: this.state.containerHeight,
      width: this.state.containerWidth
    } : {} ;
    const offsetX = (this.state.containerWidth - this.state.width) / 2;
    const modalAnimationStyle = this.props.modalAnimationType  === ANIMATION_MODAL_FADE 
      ? {
          opacity: this.state.modalOpacity,
          left: offsetX, 
          top: this.state && this.state.positionDest || 0
      } : {
          transform: [
              {translateY: this.state.position},
              {translateX: offsetX}
            ]
        };

    return (
      <Animated.View
        onLayout={this.onViewLayout}
        style={[
          styles.wrapper,
          size,
          this.props.style,
          modalAnimationStyle
        ]}
        {...this.state.pan.panHandlers}>
        {this.props.children}
      </Animated.View>
    );
  }

  /*
   * Render the component
   */
  render() {
    const visible =
      this.state.isOpen ||
      this.state.isAnimateOpen ||
      this.state.isAnimateClose;

    if (!visible) return <View />;

    const content = (
      <View
        importantForAccessibility="yes"
        accessibilityViewIsModal={true}
        style={[styles.transparent, styles.absolute]}
        pointerEvents={'box-none'}>
        <View
          style={{flex: 1}}
          pointerEvents={'box-none'}
          onLayout={this.onContainerLayout}>
          {visible && this.renderBackdrop()}
          {visible && this.renderContent()}
        </View>
      </View>
    );

    if (!this.props.coverScreen) return content;

    return (
      <Modal
        onRequestClose={() => {
          if (this.props.backButtonClose) {
            this.close();
          }
        }}
        supportedOrientations={[
          'landscape',
          'portrait',
          'portrait-upside-down'
        ]}
        transparent
        visible={visible}
        hardwareAccelerated={true}>
        {content}
      </Modal>
    );
  }

  /****************** PUBLIC METHODS **********************/

  open() {
    if (this.props.isDisabled) return;
    if (
      !this.state.isAnimateOpen &&
      (!this.state.isOpen || this.state.isAnimateClose)
    ) {
      this.onViewLayoutCalculated = () => {
        this.animateOpen();
        if (this.props.backButtonClose && Platform.OS === 'android')
          BackHandler.addEventListener('hardwareBackPress', this.onBackPress);
        this.onViewLayoutCalculated = null;
      };
      this.setState({isAnimateOpen: true});
    }
  }

  close() {
    if (this.props.isDisabled) return;
    if (
      !this.state.isAnimateClose &&
      (this.state.isOpen || this.state.isAnimateOpen)
    ) {
      this.animateClose();
      if (this.props.backButtonClose && Platform.OS === 'android')
        BackHandler.removeEventListener('hardwareBackPress', this.onBackPress);
    }
  }
}
