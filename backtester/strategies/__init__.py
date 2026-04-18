"""
Strategies Package

All trading strategies are defined here. Each strategy implements
the base Strategy class and provides generate_signals() method.
"""

from .base import Strategy
from .momentum import MomentumStrategy, AggressiveMomentum, ConservativeMomentum
from .canslim import CANSLIMStrategy, CANSLIMLite
from .regime_momentum_rs import rank_regime_momentum_rs_candidates

__all__ = [
    'Strategy',
    'MomentumStrategy',
    'AggressiveMomentum',
    'ConservativeMomentum',
    'CANSLIMStrategy',
    'CANSLIMLite',
    'rank_regime_momentum_rs_candidates',
]
